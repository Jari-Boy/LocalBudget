import type { Account, AccountCategory } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import { calculateAccountBalance } from './calculateAccountBalance'

/**
 * 指定した区分(資産・負債・純資産・収益・費用のいずれか)に属する科目の明細のみを
 * 絞り込み、calculateAccountBalanceの残高計算式(docs/domain/financial-statements.md 2.1節)を
 * 適用して区分単位の合計残高を返す。generateBalanceSheet・generateFilteredBalanceSheetの
 * 両方から共通利用される、BS純資産部の恒等式計算(「純資産科目の貸方残高+収益科目の
 * 貸方残高-費用科目の借方残高」)に使う内部ヘルパー。DB非依存の純粋関数。
 */
export function sumCategoryBalance(
  lines: readonly JournalLine[],
  accountsById: ReadonlyMap<number, Account>,
  category: AccountCategory,
): number {
  const categoryLines = lines.filter((line) => accountsById.get(line.accountId)?.category === category)
  return calculateAccountBalance(category, categoryLines)
}
