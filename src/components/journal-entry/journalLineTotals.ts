import type { JournalLineSide } from '../../domain/journal/JournalEntry'

export interface JournalLineTotalsInput {
  side: JournalLineSide | null
  amountInput: string
}

export interface JournalLineTotals {
  debitTotal: number
  creditTotal: number
  /** 借方合計 - 貸方合計。入力支援としてのリアルタイム表示専用であり、
   * 貸借バランスの正式な検証はJournalEntryRepositoryに委ねる(docs/architecture.md 12章)。 */
  difference: number
}

/**
 * 仕訳入力フォームの借方合計・貸方合計・差額をリアルタイム計算する(計画Issue #32)。
 * 金額は入力途中の文字列のまま受け取り、数値に変換できない行(空文字・非数値)は0として扱う。
 * side未選択の行はどちらの合計にも含めない。
 */
export function calculateJournalLineTotals(
  lines: readonly JournalLineTotalsInput[],
): JournalLineTotals {
  let debitTotal = 0
  let creditTotal = 0

  for (const line of lines) {
    const amount = Number(line.amountInput)
    if (!Number.isFinite(amount)) continue

    if (line.side === 'debit') {
      debitTotal += amount
    } else if (line.side === 'credit') {
      creditTotal += amount
    }
  }

  return { debitTotal, creditTotal, difference: debitTotal - creditTotal }
}
