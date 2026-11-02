import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { calculateSettlementBatchBalance } from '../settlement-batch/calculateSettlementBatchBalance'

/**
 * 割勘仕訳に対して何らかの精算操作が行われたかどうかを判定する(JournalEntryDetailScreenの
 * 取り消し導線向け、計画Issue #133)。isExpenseSplittingEntrySettled(全ての一時勘定行の残高が
 * ゼロになって初めて「精算済み」とみなす、履歴画面向けの厳密な判定)とは異なり、こちらは
 * 「少なくとも1件の精算操作が行われたか」を判定する。精算が一部でも進んだ割勘仕訳を物理削除
 * すると、既に起票済みの精算仕訳が参照先を失い整合性が崩れるため、一部でも精算が進んでいれば
 * 取り消しを禁止し返金案内に切り替える(journal_entry_linksのsettlesリンクが1件でも存在すれば
 * 精算済み扱いとしていた旧実装の挙動を、settlement_batch_idタグの集計方式で再現する)。
 * 対象の一時勘定行自身の寄与分(line.amount)を除いた残高が動いているか(=他の行がタグに
 * 乗っているか)で判定する。DBアクセスなしの純粋関数。
 */
export function hasAnySettlementActivity(
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

  return advanceLines.some((line) => {
    if (line.settlementBatchId === null) return false
    const category = accountsById.get(line.accountId)!.category as 'asset' | 'liability'
    const increasingSide = category === 'asset' ? 'debit' : 'credit'
    const ownContribution = line.side === increasingSide ? line.amount : -line.amount
    const aggregateBalance = calculateSettlementBatchBalance(allLines, category, {
      settlementBatchId: line.settlementBatchId,
      accountId: line.accountId,
      householdMemberId: line.householdMemberId,
      counterpartyId: line.counterpartyId,
    })
    return aggregateBalance !== ownContribution
  })
}
