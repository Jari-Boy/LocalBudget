import { describe, expect, it } from 'vitest'
import type { JournalEntryLinkGroupMembership } from './JournalEntryLinkGroup'
import { buildRelatedEntryIdsByEntryId } from './buildRelatedEntryIdsByEntryId'

function membership(id: number, linkGroupId: number, journalEntryId: number): JournalEntryLinkGroupMembership {
  return { id, linkGroupId, journalEntryId, createdAt: '2026-11-01T00:00:00.000Z' }
}

/**
 * buildRelatedEntryIdsByEntryId(関連仕訳グループの所属関係から、仕訳ごとの関連仕訳id集合を
 * 構築する、計画Issue #138)のテスト。DBアクセスなしの純粋関数。1つの仕訳が複数グループに
 * 所属する場合、全グループ分の関連仕訳が合算される(仕訳詳細画面の「関連する仕訳」一覧表示の
 * データソース)ことを検証する。
 */
describe('buildRelatedEntryIdsByEntryId', () => {
  it('同一グループに所属する仕訳同士を、自分自身を除いて互いに関連づける', () => {
    const result = buildRelatedEntryIdsByEntryId([membership(1, 10, 1), membership(2, 10, 2), membership(3, 10, 3)])

    expect(result.get(1)).toEqual(new Set([2, 3]))
    expect(result.get(2)).toEqual(new Set([1, 3]))
    expect(result.get(3)).toEqual(new Set([1, 2]))
  })

  it('複数グループに所属する仕訳は、両方のグループ分の関連仕訳を合算する', () => {
    const result = buildRelatedEntryIdsByEntryId([
      membership(1, 10, 1),
      membership(2, 10, 2),
      membership(3, 20, 2),
      membership(4, 20, 3),
    ])

    // entry2はグループ10(entry1と)・グループ20(entry3と)の両方に所属する
    expect(result.get(2)).toEqual(new Set([1, 3]))
    // entry1とentry3はentry2を介してのみ繋がり、互いには直接関連づかない(グループを統合しない)
    expect(result.get(1)).toEqual(new Set([2]))
    expect(result.get(3)).toEqual(new Set([2]))
  })

  it('membershipが空の場合、空のMapを返す', () => {
    const result = buildRelatedEntryIdsByEntryId([])

    expect(result.size).toBe(0)
  })

  it('グループに所属する仕訳が1件のみの場合、その仕訳の関連仕訳集合は空になる', () => {
    const result = buildRelatedEntryIdsByEntryId([membership(1, 10, 1)])

    expect(result.get(1)).toEqual(new Set())
  })
})
