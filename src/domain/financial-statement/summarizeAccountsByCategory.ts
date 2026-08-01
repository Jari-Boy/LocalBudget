import type { Account, AccountCategory } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { AccountAmount } from './AccountAmount'
import { calculateAccountBalance } from './calculateAccountBalance'

/**
 * 区分別の科目内訳集計。指定した区分(資産・負債・純資産・収益・費用のいずれか)に属する
 * 科目ごとにcalculateAccountBalanceの残高計算式(docs/domain/financial-statements.md 2.1節)を
 * 適用し、科目別の内訳一覧を返す。残高0の科目は未使用科目としてFS上に表示しないため除外する。
 * generateProfitAndLoss(revenues/expenses)・generateBalanceSheet(assets/liabilities/equity)の
 * 両方から共通利用される、PL/BSどちらにも依存しない集計ロジック。
 * DB非依存の純粋関数。
 */
export function summarizeAccountsByCategory(
  lines: readonly JournalLine[],
  accounts: readonly Account[],
  category: AccountCategory,
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
