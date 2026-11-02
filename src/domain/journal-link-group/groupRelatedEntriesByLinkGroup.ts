import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from './JournalEntryLinkGroup'

export interface RelatedEntryGroup {
  groupId: number
  name: string | null
  entries: JournalEntry[]
}

/**
 * 関連仕訳グループの所属関係(memberships)から、指定した仕訳(entryId)が所属する
 * グループごとの塊(他のメンバーの仕訳一覧)を構築する(計画Issue #138、UIレビューでの指摘
 * 「多対多のグルーピングをUIが表現できていない」への対応)。buildRelatedEntryIdsByEntryIdが
 * 全グループ分の関連仕訳を1つのSetに合算するのに対し、この関数はグループを跨いで合算せず、
 * 仕訳詳細画面の「関連する仕訳」ダイアログ(RelatedEntriesDialog)がグループ単位の枠を
 * 描き分けるためのデータソースとして使う。結果はグループid昇順(作成順)で返す。
 * DBアクセスなしの純粋関数。
 */
export function groupRelatedEntriesByLinkGroup(
  entryId: number,
  memberships: readonly JournalEntryLinkGroupMembership[],
  groupsById: ReadonlyMap<number, JournalEntryLinkGroup>,
  entriesById: ReadonlyMap<number, JournalEntry>,
): RelatedEntryGroup[] {
  const entryIdsByGroupId = new Map<number, number[]>()
  for (const membership of memberships) {
    const entryIds = entryIdsByGroupId.get(membership.linkGroupId) ?? []
    entryIds.push(membership.journalEntryId)
    entryIdsByGroupId.set(membership.linkGroupId, entryIds)
  }

  const result: RelatedEntryGroup[] = []
  for (const [groupId, entryIds] of entryIdsByGroupId) {
    if (!entryIds.includes(entryId)) continue
    const entries = entryIds
      .filter((id) => id !== entryId)
      .map((id) => entriesById.get(id))
      .filter((candidate): candidate is JournalEntry => candidate !== undefined)
    if (entries.length === 0) continue
    result.push({ groupId, name: groupsById.get(groupId)?.name ?? null, entries })
  }

  return result.sort((a, b) => a.groupId - b.groupId)
}
