import type { JournalLineSide } from '../journal/JournalEntry'

export interface ReconciliationLine {
  side: JournalLineSide
  amount: number
}

export interface BalanceReconciliationResult {
  bookBalance: number
  externalBalance: number
  isReconciled: boolean
  /** externalBalance - bookBalance。正なら帳簿残高が不足、負なら帳簿残高が超過 */
  difference: number
}

/**
 * 残高照合(docs/domain/reconciliation.md 1.5)。対象口座の該当行(external_transaction_refsを
 * 持つ行 + source_typeがinitial_balance/balance_adjustmentの行)を積み上げて帳簿残高を計算し、
 * 外部残高(external_balance_after)と比較する純粋関数。行の絞り込みクエリ自体は呼び出し側
 * (インフラ層)の責務であり、DBアクセスは一切行わない。
 *
 * 対象科目(is_reconcilable = trueの科目)は現状asset区分のみ(1.1・1.5)のため、
 * financial-statements.md 2.1の一般式のうちasset側(debit - credit)のみを採用する。
 */
export function checkBalanceReconciliation(
  lines: readonly ReconciliationLine[],
  externalBalance: number,
): BalanceReconciliationResult {
  const bookBalance = sumBySide(lines, 'debit') - sumBySide(lines, 'credit')
  const difference = externalBalance - bookBalance

  return {
    bookBalance,
    externalBalance,
    isReconciled: difference === 0,
    difference,
  }
}

function sumBySide(lines: readonly ReconciliationLine[], side: JournalLineSide): number {
  return lines.filter((line) => line.side === side).reduce((total, line) => total + line.amount, 0)
}
