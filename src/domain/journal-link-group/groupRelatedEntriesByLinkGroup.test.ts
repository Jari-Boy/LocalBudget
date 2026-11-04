import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from './JournalEntryLinkGroup'
import { groupRelatedEntriesByLinkGroup } from './groupRelatedEntriesByLinkGroup'

function membership(id: number, linkGroupId: number, journalEntryId: number): JournalEntryLinkGroupMembership {
  return { id, linkGroupId, journalEntryId, createdAt: '2026-11-01T00:00:00.000Z' }
}

function group(id: number, name: string | null): JournalEntryLinkGroup {
  return { id, name, createdAt: '2026-11-01T00:00:00.000Z' }
}

function entry(id: number): JournalEntry {
  return {
    id,
    entryDate: '2026-11-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lines: [],
  }
}

/**
 * groupRelatedEntriesByLinkGroup(関連仕訳グループの所属関係を、仕訳ごとに「所属グループ単位の
 * 塊」として構築する、計画Issue #138)のテスト。DBアクセスなしの純粋関数。
 * buildRelatedEntryIdsByEntryIdが全グループ分の関連仕訳を1つのSetに合算するのに対し、この関数は
 * グループを跨いで合算しない(UIレビューでの指摘「多対多のグルーピングをUIが表現できていない」
 * への対応、仕訳詳細画面の「関連する仕訳」ダイアログがグループ単位の枠を描き分けるためのデータ
 * ソース)。
 */
describe('groupRelatedEntriesByLinkGroup', () => {
  it('1つのグループにのみ所属する場合、そのグループ1件分を返す', () => {
    const memberships = [membership(1, 10, 1), membership(2, 10, 2), membership(3, 10, 3)]
    const groupsById = new Map([[10, group(10, null)]])
    const entriesById = new Map([2, 3].map((id) => [id, entry(id)]))

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result).toHaveLength(1)
    expect(result[0].groupId).toBe(10)
    expect(result[0].entries.map((e) => e.id).sort()).toEqual([2, 3])
  })

  it('複数グループに所属する場合、グループごとに別々の塊として返す(合算しない)', () => {
    const memberships = [membership(1, 10, 1), membership(2, 10, 2), membership(3, 20, 1), membership(4, 20, 3)]
    const groupsById = new Map([
      [10, group(10, null)],
      [20, group(20, null)],
    ])
    const entriesById = new Map([2, 3].map((id) => [id, entry(id)]))

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result).toHaveLength(2)
    const byGroupId = new Map(result.map((r) => [r.groupId, r.entries.map((e) => e.id)]))
    expect(byGroupId.get(10)).toEqual([2])
    expect(byGroupId.get(20)).toEqual([3])
  })

  it('グループに名前が設定されている場合、その名前を含めて返す', () => {
    const memberships = [membership(1, 10, 1), membership(2, 10, 2)]
    const groupsById = new Map([[10, group(10, '26/7生活費')]])
    const entriesById = new Map([[2, entry(2)]])

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result[0].name).toBe('26/7生活費')
  })

  it('所属していないグループは結果に含まれない', () => {
    const memberships = [membership(1, 10, 2), membership(2, 10, 3)]
    const groupsById = new Map([[10, group(10, null)]])
    const entriesById = new Map([2, 3].map((id) => [id, entry(id)]))

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result).toEqual([])
  })

  it('所属グループのメンバーが自分のみ(他の仕訳が無い)場合、そのグループは結果に含まれない', () => {
    const memberships = [membership(1, 10, 1)]
    const groupsById = new Map([[10, group(10, null)]])
    const entriesById = new Map<number, JournalEntry>()

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result).toEqual([])
  })

  it('グループidの昇順(作成順)で返す', () => {
    const memberships = [membership(1, 20, 1), membership(2, 20, 2), membership(3, 10, 1), membership(4, 10, 3)]
    const groupsById = new Map([
      [20, group(20, null)],
      [10, group(10, null)],
    ])
    const entriesById = new Map([2, 3].map((id) => [id, entry(id)]))

    const result = groupRelatedEntriesByLinkGroup(1, memberships, groupsById, entriesById)

    expect(result.map((r) => r.groupId)).toEqual([10, 20])
  })
})
