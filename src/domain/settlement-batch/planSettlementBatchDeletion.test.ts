/**
 * planSettlementBatchDeletion(精算バッチを、アプリが作った割勘仕訳ごと削除できるかを決める純粋関数、
 * 計画Issue #153)のユニットテスト。バッチのタグが付いた仕訳がすべて割勘仕訳(expense_splitting)なら
 * 削除でき、削除する仕訳はその割勘仕訳だけであること、精算で紐づけた既存の仕訳や精算の仕訳が
 * 1件でもあれば削除できず、明細の無い空のバッチは削除できることを検証する。DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import { planSettlementBatchDeletion } from './planSettlementBatchDeletion'

function entry(id: number, sourceType: JournalEntry['sourceType'], batchIds: (number | null)[]): JournalEntry {
  return {
    id,
    sourceType,
    lines: batchIds.map((settlementBatchId, i) => ({ id: id * 10 + i, journalEntryId: id, settlementBatchId })),
  } as unknown as JournalEntry
}

describe('planSettlementBatchDeletion', () => {
  it('タグが付いた仕訳がすべて割勘仕訳なら、その割勘仕訳だけを削除対象にする', () => {
    const entries = [
      entry(1, 'manual', [null, null]),
      entry(2, 'expense_splitting', [null, 7, null, 7]),
      entry(3, 'expense_splitting', [7, 7]),
      entry(4, 'expense_splitting', [8, 8]),
    ]

    expect(planSettlementBatchDeletion(7, entries)).toEqual({ deletable: true, splitEntryIds: [2, 3] })
  })

  it('明細の無い空のバッチは、削除する仕訳が無いまま削除できる', () => {
    expect(planSettlementBatchDeletion(7, [entry(1, 'manual', [null])])).toEqual({ deletable: true, splitEntryIds: [] })
  })

  it('精算で紐づけた既存の仕訳や精算の仕訳(割勘仕訳以外)が1件でもあれば、削除できない', () => {
    const entries = [entry(2, 'expense_splitting', [7, 7]), entry(5, 'manual', [null, 7])]

    expect(planSettlementBatchDeletion(7, entries)).toEqual({ deletable: false, splitEntryIds: [] })
  })
})
