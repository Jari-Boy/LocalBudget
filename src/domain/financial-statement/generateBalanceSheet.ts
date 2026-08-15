import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { AccountAmount } from './AccountAmount'
import { summarizeAccountsByCategory } from './summarizeAccountsByCategory'
import { sumCategoryBalance } from './sumCategoryBalance'

export interface BalanceSheet {
  asOfDate: string
  assets: AccountAmount[]
  liabilities: AccountAmount[]
  equity: AccountAmount[]
  cumulativeNetIncome: number
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
}

/**
 * BS(貸借対照表)の生成(docs/domain/financial-statements.md 2.1節)。
 * ある基準日(asOfDate、当日を含む)までの資産科目・負債科目・純資産科目の残高を計算する。
 * 決算振替仕訳(収益・費用を繰越利益へ振り替える仕訳)を行わない設計であるため、
 * 純資産部は恒等式「資産 = 負債 + 純資産 + (収益 - 費用)」が任意の基準日で成立するように、
 * 「純資産科目の貸方残高 + 収益科目の貸方残高 - 費用科目の借方残高」で計算する
 * (cumulativeNetIncomeが収益-費用の部分に相当)。
 * DB非依存の純粋関数。entries・accountsは呼び出し側がRepositoryから取得して渡す。
 */
export function generateBalanceSheet(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOfDate: string,
): BalanceSheet {
  const linesAsOfDate = entries
    .filter((entry) => entry.entryDate <= asOfDate)
    .flatMap((entry) => entry.lines)
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const assets = summarizeAccountsByCategory(linesAsOfDate, accounts, 'asset')
  const liabilities = summarizeAccountsByCategory(linesAsOfDate, accounts, 'liability')
  const equity = summarizeAccountsByCategory(linesAsOfDate, accounts, 'equity')

  const equityOwnBalance = sumCategoryBalance(linesAsOfDate, accountsById, 'equity')
  const revenueBalance = sumCategoryBalance(linesAsOfDate, accountsById, 'revenue')
  const expenseBalance = sumCategoryBalance(linesAsOfDate, accountsById, 'expense')
  const cumulativeNetIncome = revenueBalance - expenseBalance

  return {
    asOfDate,
    assets,
    liabilities,
    equity,
    cumulativeNetIncome,
    totalAssets: assets.reduce((total, item) => total + item.amount, 0),
    totalLiabilities: liabilities.reduce((total, item) => total + item.amount, 0),
    totalEquity: equityOwnBalance + cumulativeNetIncome,
  }
}
