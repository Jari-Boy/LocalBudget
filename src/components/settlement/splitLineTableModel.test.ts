/**
 * splitLineTableModel(割勘タブの候補表の行の組み立て、計画Issue #271)の純粋関数のユニットテスト。
 * 仕訳の明細行を借方・貸方に分けて行番号で対応づけた表の行にすること(仕訳一覧の明細行単位の表と同じ並び)、
 * 仕訳の先頭の行にだけ日付・摘要を出す印(isFirst)を付けること、見出しの全選択の対象(各側の選べる行)を返すことを検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { SplittableLineEntry } from '../../domain/expense-splitting/listSplittableLineEntries'
import { buildSplitLineTableRows, selectableLineIdsBySide } from './splitLineTableModel'

function line(id: number, side: 'debit' | 'credit'): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId: 1,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount: 100,
    createdAt: '',
  }
}

function item(entryId: number, lines: Array<[number, 'debit' | 'credit', boolean]>): SplittableLineEntry {
  return {
    entry: { id: entryId } as JournalEntry,
    lines: lines.map(([id, side, selectable]) => ({
      line: line(id, side),
      selectable,
      reason: selectable ? null : 'not_profit_loss_account',
    })),
  }
}

describe('buildSplitLineTableRows', () => {
  it('借方の行と貸方の行を、先頭から順に左右へ対応づける(足りない側は空欄)', () => {
    const rows = buildSplitLineTableRows([item(1, [[1, 'debit', true], [2, 'debit', true], [3, 'credit', false]])])
    expect(rows.map((r) => [r.debit?.line.id ?? null, r.credit?.line.id ?? null])).toEqual([
      [1, 3],
      [2, null],
    ])
  })

  it('仕訳の先頭の行にだけisFirstを付ける', () => {
    const rows = buildSplitLineTableRows([item(1, [[1, 'debit', true], [2, 'debit', true]]), item(2, [[3, 'credit', true]])])
    expect(rows.map((r) => [r.entry.id, r.isFirst])).toEqual([
      [1, true],
      [1, false],
      [2, true],
    ])
  })
})

describe('selectableLineIdsBySide', () => {
  it('各側の選べる行のidだけを返す(選べない行は含めない)', () => {
    const items = [item(1, [[1, 'debit', true], [2, 'credit', false]]), item(2, [[3, 'credit', true]])]
    expect(selectableLineIdsBySide(items, 'debit')).toEqual([1])
    expect(selectableLineIdsBySide(items, 'credit')).toEqual([3])
  })
})
