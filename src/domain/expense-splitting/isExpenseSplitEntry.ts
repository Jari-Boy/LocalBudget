import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'

/** is_system_managed=trueの資産/負債(立替金)科目の行を持つか(docs/domain/expense-splitting.md 1.2節) */
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
 * ある仕訳が割勘仕訳(docs/domain/expense-splitting.md 1.3・1.4節)自身であるかどうかを、
 * journal_entry_links(計画Issue #138で撤廃)ではなく科目構成から判定する。割勘仕訳は
 * 必ず「費用を付け替える行(expense科目)」と「立替金の発生行(is_system_managed=trueの
 * 資産/負債科目)」の両方を持つ(buildHouseholdMemberExpenseSplittingJournalEntryInput/
 * buildCounterpartyExpenseSplittingJournalEntryInputが組み立てる行構成に対応)。これに対し、
 * 元の支出仕訳(割勘対象になる側)は立替金行を持たず、精算仕訳(buildSettlementJournalEntryInput)
 * は立替金行を持つが費用行を持たない。この3者を科目構成だけで区別できる
 * (isExpenseSplitSettlementEntryと対になる判定)。DBアクセスなしの純粋関数。
 */
export function isExpenseSplitEntry(entry: JournalEntry, accounts: readonly Account[]): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  return hasAdvanceLine(entry, accountsById) && hasExpenseLine(entry, accountsById)
}
