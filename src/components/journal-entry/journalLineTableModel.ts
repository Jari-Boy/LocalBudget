import type { JournalLineSide } from '../../domain/journal/JournalEntry'

/**
 * 仕訳一覧の「明細行単位」の表(計画Issue #182)の、行の組み立て(純粋関数)。
 * DB・DOM非依存。
 */

/** 表の1行。借方と貸方の明細行を行番号で対応づけたもので、足りない側は null(空欄) */
export interface LinePair<T> {
  debit: T | null
  credit: T | null
}

/**
 * 仕訳の明細行を借方・貸方に分け、先頭から順に対応づけた表の行にする。借方3行・貸方1行の
 * 複合仕訳なら3行になり、貸方の2・3行目は null。各側の並び順は入力順のまま。貸借の区分が
 * 未設定(null)の行は表に載せない。明細が0行でも、編集中の入力欄を出せるよう空欄の1行を返す。
 */
export function pairLinesBySide<T extends { side: JournalLineSide | null }>(
  lines: readonly T[],
): LinePair<T>[] {
  const debits = lines.filter((l) => l.side === 'debit')
  const credits = lines.filter((l) => l.side === 'credit')
  const count = Math.max(debits.length, credits.length, 1)
  return Array.from({ length: count }, (_, i) => ({
    debit: debits[i] ?? null,
    credit: credits[i] ?? null,
  }))
}
