import type { JournalEntryLinkGroupMembership } from './JournalEntryLinkGroup'

/**
 * 関連仕訳グループの所属関係(memberships)から、仕訳idごとの関連仕訳id集合を構築する
 * (計画Issue #138)。1つの仕訳が複数のグループに同時に所属する場合、それぞれのグループの
 * メンバーが合算される(仕訳詳細画面の「関連する仕訳」一覧表示・割勘履歴機能の両方で使う
 * データソース)。グループを跨いだ推移的な統合は行わない(例: entry1-entry2が同じグループ、
 * entry2-entry3が別のグループの場合、entry1とentry3は直接の関連を持たない)。
 * DBアクセスなしの純粋関数。membershipsの取得(DBクエリ)はJournalEntryLinkGroupRepository
 * 側の責務。
 */
export function buildRelatedEntryIdsByEntryId(
  memberships: readonly JournalEntryLinkGroupMembership[],
): Map<number, Set<number>> {
  const entryIdsByGroupId = new Map<number, number[]>()
  for (const membership of memberships) {
    const entryIds = entryIdsByGroupId.get(membership.linkGroupId) ?? []
    entryIds.push(membership.journalEntryId)
    entryIdsByGroupId.set(membership.linkGroupId, entryIds)
  }

  const result = new Map<number, Set<number>>()
  for (const entryIds of entryIdsByGroupId.values()) {
    for (const entryId of entryIds) {
      const related = result.get(entryId) ?? new Set<number>()
      for (const other of entryIds) {
        if (other !== entryId) related.add(other)
      }
      result.set(entryId, related)
    }
  }
  return result
}
