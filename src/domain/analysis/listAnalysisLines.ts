import type { Account, AccountCategory } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from '../financial-statement/FinancialStatementFilter'
import type { Period } from '../financial-statement/Period'
import { filterJournalLinesByFinancialStatementFilter } from '../financial-statement/filterJournalLinesByFinancialStatementFilter'

/** グラフ・表の金額の内訳として出す、仕訳の1明細(計画Issue #155)。 */
export interface AnalysisLine {
  entryId: number
  lineId: number
  date: string
  memo: string | null
  accountId: number
  accountName: string
  /** 文脈ごとの符号つきの金額(listPeriodLines・listEquityChangeLinesの説明を参照) */
  amount: number
}

export interface PeriodLineSelection {
  categories?: readonly AccountCategory[]
  accountIds?: readonly number[]
}

function collect(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  period: Period,
  filter: FinancialStatementFilter,
  amountOf: (account: Account, side: 'debit' | 'credit', amount: number) => number | null,
  accountPredicate: (account: Account) => boolean,
): AnalysisLine[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const entriesInPeriod = entries
    .filter((entry) => entry.entryDate >= period.from && entry.entryDate <= period.to)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id)
  const result: AnalysisLine[] = []
  for (const entry of entriesInPeriod) {
    const lines = filterJournalLinesByFinancialStatementFilter([entry], filter)
    for (const line of lines) {
      const account = accountsById.get(line.accountId)
      if (!account || !accountPredicate(account)) continue
      const amount = amountOf(account, line.side, line.amount)
      if (amount === null) continue
      result.push({
        entryId: entry.id,
        lineId: line.id,
        date: entry.entryDate,
        memo: entry.memo,
        accountId: account.id,
        accountName: account.name,
        amount,
      })
    }
  }
  return result
}

/**
 * 期間内の明細を、科目の増加側を正とした金額(PLの金額と同じ式。収益・負債・純資産は貸方−借方、
 * 資産・費用は借方−貸方)で返す。費用の貸方(取消・返金)はマイナスになり、合計がPLの金額と一致する。
 * 区分(categories)か科目(accountIds)で対象を絞る(どちらも省略すると全科目)。DB非依存の純粋関数。
 */
export function listPeriodLines(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  period: Period,
  filter: FinancialStatementFilter,
  selection: PeriodLineSelection,
): AnalysisLine[] {
  const categories = selection.categories ? new Set(selection.categories) : null
  const accountIds = selection.accountIds ? new Set(selection.accountIds) : null
  return collect(
    entries,
    accounts,
    period,
    filter,
    (account, side, amount) => {
      const increasesOnDebit = account.category === 'asset' || account.category === 'expense'
      return (side === 'debit') === increasesOnDebit ? amount : -amount
    },
    (account) => (categories === null || categories.has(account.category)) && (accountIds === null || accountIds.has(account.id)),
  )
}

/**
 * 期間内の、純資産の増減に効く明細(純資産・収益・費用)を、純資産への影響額(貸方−借方。
 * 収益はプラス、費用はマイナス)で返す。初期残高や残高調整の仕訳も含む。合計は、期間の前日末から
 * 期間末までのBSの純資産合計の増減と一致する。DB非依存の純粋関数。
 */
export function listEquityChangeLines(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  period: Period,
  filter: FinancialStatementFilter,
): AnalysisLine[] {
  return collect(
    entries,
    accounts,
    period,
    filter,
    (_account, side, amount) => (side === 'credit' ? amount : -amount),
    (account) => account.category === 'equity' || account.category === 'revenue' || account.category === 'expense',
  )
}
