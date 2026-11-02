import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { calculateSettlementBatchBalance } from '../settlement-batch/calculateSettlementBatchBalance'

/**
 * 割勘仕訳の精算状況判定(docs/domain/expense-splitting.md 1.3・1.5節)。
 * 割勘仕訳が持つ立替金科目(is_system_managed=trueの資産・負債)の行それぞれについて
 * settlement-batchドメインのcalculateSettlementBatchBalanceを適用し、いずれの残高も0に
 * なって初めて「精算済み」とみなす。世帯メンバー間の割勘は資産側(立替者の債権)・負債側
 * (分担者の債務)が別々のタイミングで精算されうる(1.3節、精算1・精算2)ため、
 * 片方のみの精算を「精算済み」と誤判定しないよう両方を確認する。世帯外の相手との
 * 割勘は資産側の行しか持たないため、その1件のみで判定される。
 *
 * 残高集計は`settlement_batch_id`・科目・世帯メンバー/取引先のタグ一致による集計方式
 * (計画Issue #133)のため、割勘仕訳自身の行だけでなくDB全体の明細行(allLines)を渡す必要が
 * ある。journal_entry_linksのような明示的なリンクには依存しない。DBアクセスなしの純粋関数。
 */
export function isExpenseSplittingEntrySettled(
  splitEntry: JournalEntry,
  accounts: readonly Account[],
  allLines: readonly JournalLine[],
): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const advanceLines = splitEntry.lines.filter((line) => {
    const account = accountsById.get(line.accountId)
    return (
      account?.isSystemManaged === true && (account.category === 'asset' || account.category === 'liability')
    )
  })

  return advanceLines.every((line) => {
    if (line.settlementBatchId === null) return false
    const category = accountsById.get(line.accountId)!.category as 'asset' | 'liability'
    return (
      calculateSettlementBatchBalance(allLines, category, {
        settlementBatchId: line.settlementBatchId,
        accountId: line.accountId,
        householdMemberId: line.householdMemberId,
        counterpartyId: line.counterpartyId,
      }) === 0
    )
  })
}
