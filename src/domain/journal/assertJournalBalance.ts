import type { JournalLineSide } from './JournalEntry'
import { UnbalancedJournalEntryError } from './UnbalancedJournalEntryError'

/**
 * 仕訳明細群の借方合計と貸方合計が一致するかを検証する純粋関数(docs/domain/journal.md 1.3)。
 * 1件の仕訳は2件以上の明細から成る(docs/domain/journal.md 1.1)ため、明細が2件未満の場合も
 * 有効な仕訳として成立しないとみなし、UnbalancedJournalEntryErrorをスローする。
 * DBアクセスを一切行わない。
 */
export function assertJournalBalance(
  lines: readonly { side: JournalLineSide; amount: number }[],
): void {
  const debitTotal = sumBySide(lines, 'debit')
  const creditTotal = sumBySide(lines, 'credit')

  if (lines.length < 2 || debitTotal !== creditTotal) {
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
