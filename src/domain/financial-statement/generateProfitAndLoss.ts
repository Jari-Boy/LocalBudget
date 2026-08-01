import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { calculateAccountBalance } from './calculateAccountBalance'

export interface AccountAmount {
  accountId: number
  accountName: string
  amount: number
}

export interface ProfitAndLoss {
  periodFrom: string
  periodTo: string
  revenues: AccountAmount[]
  expenses: AccountAmount[]
  totalRevenue: number
  totalExpense: number
  netIncome: number
}

function summarizeByAccount(
  lines: readonly JournalLine[],
  accounts: readonly Account[],
  category: 'revenue' | 'expense',
): AccountAmount[] {
  return accounts
    .filter((account) => account.category === category)
    .map((account) => {
      const accountLines = lines.filter((line) => line.accountId === account.id)
      return {
        accountId: account.id,
        accountName: account.name,
        amount: calculateAccountBalance(category, accountLines),
      }
    })
    .filter((accountAmount) => accountAmount.amount !== 0)
}

/**
 * PL(損益計算書)の生成(docs/domain/financial-statements.md 2.1節)。
 * 指定期間(periodFrom〜periodTo、両端を含む)内の仕訳明細のうち、収益科目・費用科目に
 * 属するものを科目別に集計する。資産・負債・純資産科目の明細はPLの対象外。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function generateProfitAndLoss(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  periodFrom: string,
  periodTo: string,
): ProfitAndLoss {
  const linesInPeriod = entries
    .filter((entry) => entry.entryDate >= periodFrom && entry.entryDate <= periodTo)
    .flatMap((entry) => entry.lines)

  const revenues = summarizeByAccount(linesInPeriod, accounts, 'revenue')
  const expenses = summarizeByAccount(linesInPeriod, accounts, 'expense')
  const totalRevenue = revenues.reduce((total, item) => total + item.amount, 0)
  const totalExpense = expenses.reduce((total, item) => total + item.amount, 0)

  return {
    periodFrom,
    periodTo,
    revenues,
    expenses,
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
  }
}
