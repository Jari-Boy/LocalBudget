import type { JournalEntry } from '../journal/JournalEntry'

/**
 * タグ不整合の事後検知(docs/domain/settlement.md 1.8)。
 * to_entry側の一時勘定行(settlementAccountId)それぞれについて、fromEntry(消込仕訳)側に
 * 同じaccount_id/project_id/household_member_idを持ちamountがlinkAmount以上の行が
 * 存在するかを確認する。作成時のハード検証(SqlJsJournalEntryRepository.assertSettlementTagMatch、
 * docs/domain/settlement.md 1.8)と同じ「一致する行が存在するか」という存在チェックの考え方を
 * 踏襲し、行同士の1:1対応の厳密な特定は行わない(journal_entry_links側に対応する物理行を
 * 一意に特定する情報がないため)。一致する行が1件も存在しない場合にtrue(不整合)を返す。
 */
export function detectSettlementTagMismatch(
  toEntry: JournalEntry,
  fromEntry: JournalEntry,
  settlementAccountId: number,
  linkAmount: number,
): boolean {
  const toCandidates = toEntry.lines.filter((line) => line.accountId === settlementAccountId)

  const hasMatch = toCandidates.some((candidate) =>
    fromEntry.lines.some(
      (line) =>
        line.accountId === candidate.accountId &&
        line.projectId === candidate.projectId &&
        line.householdMemberId === candidate.householdMemberId &&
        line.amount >= linkAmount,
    ),
  )

  return !hasMatch
}
