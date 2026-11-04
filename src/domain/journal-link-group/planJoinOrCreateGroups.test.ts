import { describe, expect, it } from 'vitest'
import { planJoinOrCreateGroups } from './planJoinOrCreateGroups'

/**
 * planJoinOrCreateGroups(関連仕訳グループへの参加/新規作成の判定、計画Issue #138)のテスト。
 * DBアクセスなしの純粋関数。anchorEntryIds(既存の仕訳群)が既にグループに所属しているかどうかで
 * 「既存グループへ参加」か「新規グループを作成」かを判定するロジックを検証する。
 */
describe('planJoinOrCreateGroups', () => {
  it('anchorEntryIdsがいずれのグループにも所属していない場合、全entryIdを含む新規グループ作成を計画する', () => {
    const plan = planJoinOrCreateGroups([1, 2], [3], new Map())

    expect(plan).toEqual({ type: 'create', journalEntryIds: [1, 2, 3] })
  })

  it('anchorEntryIdsの一部が既にグループに所属している場合、そのグループへnewEntryIdsを参加させる計画を返す', () => {
    const existingGroupIdsByEntryId = new Map([[1, [100]]])
    const plan = planJoinOrCreateGroups([1, 2], [3], existingGroupIdsByEntryId)

    expect(plan).toEqual({ type: 'join', groupIds: [100], newEntryIds: [3] })
  })

  it('anchorEntryIdsが複数の異なるグループに所属している場合、すべてのグループへ参加させる計画を返す(グループ同士は統合しない)', () => {
    const existingGroupIdsByEntryId = new Map([
      [1, [100]],
      [2, [200]],
    ])
    const plan = planJoinOrCreateGroups([1, 2], [3], existingGroupIdsByEntryId)

    expect(plan).toEqual({ type: 'join', groupIds: [100, 200], newEntryIds: [3] })
  })

  it('journalEntryIdsの重複を排除する(create計画)', () => {
    const plan = planJoinOrCreateGroups([1, 1], [1, 2], new Map())

    expect(plan).toEqual({ type: 'create', journalEntryIds: [1, 2] })
  })

  it('newEntryIdsの重複を排除する(join計画)', () => {
    const existingGroupIdsByEntryId = new Map([[1, [100]]])
    const plan = planJoinOrCreateGroups([1], [2, 2], existingGroupIdsByEntryId)

    expect(plan).toEqual({ type: 'join', groupIds: [100], newEntryIds: [2] })
  })

  it('同じグループidが複数のanchorEntryIdに重複して現れても1回だけ計画に含める', () => {
    const existingGroupIdsByEntryId = new Map([
      [1, [100]],
      [2, [100]],
    ])
    const plan = planJoinOrCreateGroups([1, 2], [3], existingGroupIdsByEntryId)

    expect(plan).toEqual({ type: 'join', groupIds: [100], newEntryIds: [3] })
  })
})
