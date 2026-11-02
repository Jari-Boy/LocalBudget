import type { JournalLine } from '../journal/JournalEntry'

export interface SettlementTagMatch {
  settlementBatchId: number
  accountId: number
  householdMemberId: number | null
  counterpartyId: number | null
}

/**
 * settlement_batch_id・科目・世帯メンバー/取引先のタグが一致する明細行を持つ仕訳のidを
 * 重複なく返す(計画Issue #138)。精算仕訳(buildSettlementJournalEntryInput)の作成時、
 * この精算が実際にどの割勘仕訳(または過去の精算仕訳)を解消する対象なのかを特定し、
 * それらと同じ関連仕訳グループへ参加させる(joinOrCreateGroups)ために使う。
 * 残高計算自体はcalculateSettlementBatchBalance(タグ集計方式)が担うため、本関数は
 * あくまで表示目的のグルーピングのための補助。DBアクセスなしの純粋関数。
 */
export function findEntryIdsWithSettlementTag(
  allLines: readonly JournalLine[],
  tag: SettlementTagMatch,
): number[] {
  const ids = new Set<number>()
  for (const line of allLines) {
    if (
      line.settlementBatchId === tag.settlementBatchId &&
      line.accountId === tag.accountId &&
      line.householdMemberId === tag.householdMemberId &&
      line.counterpartyId === tag.counterpartyId
    ) {
      ids.add(line.journalEntryId)
    }
  }
  return [...ids]
}
