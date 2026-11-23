import type { JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type { SplittableLine, SplittableLineEntry } from '../../domain/expense-splitting/listSplittableLineEntries'
import { pairLinesBySide } from '../journal-entry/journalLineTableModel'

/**
 * 割勘タブの候補表(明細行単位、計画Issue #271)の行の組み立て。仕訳一覧の明細行単位の表と同じく、借方の行を左・
 * 貸方の行を右に行番号で対応づける。DB・DOM非依存。
 */

export interface SplitLineTableRow {
  entry: JournalEntry
  /** 仕訳の先頭の行(日付・摘要を出す) */
  isFirst: boolean
  debit: SplittableLine | null
  credit: SplittableLine | null
}

export function buildSplitLineTableRows(items: readonly SplittableLineEntry[]): SplitLineTableRow[] {
  return items.flatMap(({ entry, lines }) =>
    pairLinesBySide(lines.map((l) => ({ side: l.line.side as JournalLineSide | null, item: l }))).map((pair, index) => ({
      entry,
      isFirst: index === 0,
      debit: pair.debit?.item ?? null,
      credit: pair.credit?.item ?? null,
    })),
  )
}

/** 見出しの全選択の対象: 表示中の、その側の選べる行のid */
export function selectableLineIdsBySide(items: readonly SplittableLineEntry[], side: JournalLineSide): number[] {
  return items.flatMap(({ lines }) => lines.filter((l) => l.selectable && l.line.side === side).map((l) => l.line.id))
}
