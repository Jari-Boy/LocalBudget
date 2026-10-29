import type { JournalLine } from '../journal/JournalEntry'

/**
 * タグ不整合の事後検知(docs/domain/settlement.md 1.8、計画Issue #132)。
 * settlesリンクが指す2つの明細行(to_line:消し込まれる側、from_line:消し込む側)を直接比較し、
 * 作成時のハード検証(SqlJsJournalEntryRepository.assertLinkLinesCompatible)の条件が
 * 事後の編集で崩れていればtrue(不整合)を返す。条件は科目の一致、貸借が逆であること、
 * household_member_id・counterparty_id・project_idの一致、from_lineの金額がリンク金額以上で
 * あること。リンクが明細行を直接指すため、仕訳内に「一致する行が存在するか」を探す必要はない。
 */
export function detectSettlementTagMismatch(
  toLine: JournalLine,
  fromLine: JournalLine,
  linkAmount: number,
): boolean {
  const isCompatible =
    fromLine.accountId === toLine.accountId &&
    fromLine.side !== toLine.side &&
    fromLine.projectId === toLine.projectId &&
    fromLine.householdMemberId === toLine.householdMemberId &&
    fromLine.counterpartyId === toLine.counterpartyId &&
    fromLine.amount >= linkAmount

  return !isCompatible
}
