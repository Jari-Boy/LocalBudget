import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from './FinancialStatementFilter'
import type { BalanceSheet } from './generateBalanceSheet'
import { filterJournalLinesByFinancialStatementFilter } from './filterJournalLinesByFinancialStatementFilter'
import { summarizeAccountsByCategory } from './summarizeAccountsByCategory'
import { sumCategoryBalance } from './sumCategoryBalance'

/**
 * 複数軸フィルタ(プロジェクト・世帯メンバー・取引先、docs/domain/financial-statements.md
 * 2.2節)付きBS生成(計画Issue #34)。generateBalanceSheetと同じ基準日フィルタリング
 * (asOfDate、当日を含む)に、filterJournalLinesByFinancialStatementFilterによる
 * 軸フィルタリングを組み合わせる。恒等式「資産=負債+純資産+(収益-費用)」の計算方法は
 * generateBalanceSheetと同一(sumCategoryBalanceを共通利用)。generateBalanceSheet自体の
 * 責務(全期間対象のBS生成)は変更せず、絞り込みが必要な呼び出し元向けに別関数として
 * 提供する(Issue #34設計協議での判断、docs/decisions.md参照)。filterを省略した場合は
 * 絞り込みなしのgenerateBalanceSheetと同じ結果になる。DB非依存の純粋関数。
 */
export function generateFilteredBalanceSheet(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOfDate: string,
  filter: FinancialStatementFilter = {},
): BalanceSheet {
  const entriesAsOfDate = entries.filter((entry) => entry.entryDate <= asOfDate)
  const lines = filterJournalLinesByFinancialStatementFilter(entriesAsOfDate, accounts, filter)
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const assets = summarizeAccountsByCategory(lines, accounts, 'asset')
  const liabilities = summarizeAccountsByCategory(lines, accounts, 'liability')
  const equity = summarizeAccountsByCategory(lines, accounts, 'equity')

  const equityOwnBalance = sumCategoryBalance(lines, accountsById, 'equity')
  const revenueBalance = sumCategoryBalance(lines, accountsById, 'revenue')
  const expenseBalance = sumCategoryBalance(lines, accountsById, 'expense')
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
