import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'

function hasAdvanceLine(entry: JournalEntry, accountsById: ReadonlyMap<number, Account>): boolean {
  return entry.lines.some((line) => {
    const account = accountsById.get(line.accountId)
    return account?.isSystemManaged === true && (account.category === 'asset' || account.category === 'liability')
  })
}

function hasExpenseLine(entry: JournalEntry, accountsById: ReadonlyMap<number, Account>): boolean {
  return entry.lines.some((line) => accountsById.get(line.accountId)?.category === 'expense')
}

/**
 * ある仕訳が割勘の精算仕訳(buildSettlementJournalEntryInput、docs/domain/
 * expense-splitting.md 1.3・1.4節の「精算1」「精算2」)であるかどうかを科目構成から判定する
 * (isExpenseSplitEntryと対になる判定、計画Issue #138)。精算仕訳は立替金の発生行
 * (is_system_managed=trueの資産/負債科目)を持つが、割勘仕訳と異なり費用(expense)の
 * 付け替え行は持たない(立替金⇔実際の入出金口座の2行仕訳のみ)。DBアクセスなしの純粋関数。
 */
export function isExpenseSplitSettlementEntry(entry: JournalEntry, accounts: readonly Account[]): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  return hasAdvanceLine(entry, accountsById) && !hasExpenseLine(entry, accountsById)
}
