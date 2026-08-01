import type { AccountCategory } from '../account/Account'
import type { JournalLineSide } from '../journal/JournalEntry'

export interface BalanceLine {
  side: JournalLineSide
  amount: number
}

/**
 * 区分ごとの残高計算の一般式(docs/domain/financial-statements.md 2.1節)。
 * 資産・費用は増加側が借方のためdebit-credit、負債・純資産・収益は増加側が貸方のため
 * credit-debitで計算する。DB非依存の純粋関数。
 */
export function calculateAccountBalance(
  category: AccountCategory,
  lines: readonly BalanceLine[],
): number {
  const debitTotal = lines
    .filter((line) => line.side === 'debit')
    .reduce((total, line) => total + line.amount, 0)
  const creditTotal = lines
    .filter((line) => line.side === 'credit')
    .reduce((total, line) => total + line.amount, 0)

  const increaseSide: JournalLineSide =
    category === 'asset' || category === 'expense' ? 'debit' : 'credit'

  return increaseSide === 'debit' ? debitTotal - creditTotal : creditTotal - debitTotal
}
