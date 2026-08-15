import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from './FinancialStatementFilter'
import type { ProfitAndLoss } from './generateProfitAndLoss'
import { filterJournalLinesByFinancialStatementFilter } from './filterJournalLinesByFinancialStatementFilter'
import { summarizeAccountsByCategory } from './summarizeAccountsByCategory'

/**
 * 複数軸フィルタ(プロジェクト・世帯メンバー・取引先、docs/domain/financial-statements.md
 * 2.2節)付きPL生成(計画Issue #34)。generateProfitAndLossと同じ期間フィルタリング
 * (periodFrom〜periodTo、両端を含む)に、filterJournalLinesByFinancialStatementFilterに
 * よる軸フィルタリングを組み合わせる。generateProfitAndLoss自体の責務(全期間対象の
 * PL生成)は変更せず、絞り込みが必要な呼び出し元向けに別関数として提供する
 * (Issue #34設計協議での判断、docs/decisions.md参照)。filterを省略した場合は
 * 絞り込みなしのgenerateProfitAndLossと同じ結果になる。DB非依存の純粋関数。
 */
export function generateFilteredProfitAndLoss(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  periodFrom: string,
  periodTo: string,
  filter: FinancialStatementFilter = {},
): ProfitAndLoss {
  const entriesInPeriod = entries.filter(
    (entry) => entry.entryDate >= periodFrom && entry.entryDate <= periodTo,
  )
  const lines = filterJournalLinesByFinancialStatementFilter(entriesInPeriod, accounts, filter)

  const revenues = summarizeAccountsByCategory(lines, accounts, 'revenue')
  const expenses = summarizeAccountsByCategory(lines, accounts, 'expense')
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
