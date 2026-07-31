import type { JournalLineSide } from './JournalEntry'
import { UnbalancedJournalEntryError } from './UnbalancedJournalEntryError'

/**
 * 仕訳明細群の借方合計と貸方合計が一致するかを検証する純粋関数(docs/domain/journal.md 1.3)。
 * 不一致の場合はUnbalancedJournalEntryErrorをスローする。DBアクセスを一切行わない。
 */
export function assertJournalBalance(
  lines: readonly { side: JournalLineSide; amount: number }[],
): void {
  const debitTotal = sumBySide(lines, 'debit')
  const creditTotal = sumBySide(lines, 'credit')

  if (debitTotal !== creditTotal) {
    throw new UnbalancedJournalEntryError(debitTotal, creditTotal)
  }
}

function sumBySide(
  lines: readonly { side: JournalLineSide; amount: number }[],
  side: JournalLineSide,
): number {
  return lines
    .filter((line) => line.side === side)
    .reduce((total, line) => total + line.amount, 0)
}
