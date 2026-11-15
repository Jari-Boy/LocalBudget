/**
 * historyDisplay(操作履歴の表示用の集計、計画Issue #202)の単体テスト。
 * 外部依存なし(純粋関数)。戻す操作の集計(仕訳・マスタへの影響件数)と、操作ごとの「取消でどうなるか」の
 * 内訳(追加は削除、変更は元に戻す、削除は復元)の組み立てを検証する。
 */
import { describe, expect, it } from 'vitest'
import type { HistoryOperation } from '../../infrastructure/history/OperationHistory'
import { describeUndoSteps, summarizeImpact } from './historyDisplay'

function op(label: string, changes: HistoryOperation['changes']): HistoryOperation {
  return { id: 1, label, recordedAt: '2026-11-15T05:00:00.000Z', changes }
}

describe('summarizeImpact', () => {
  it('仕訳(journal_entries)とマスタの表の変更件数を、操作をまたいで合計する', () => {
    const result = summarizeImpact([
      op('journalEntry.create', [
        { table: 'journal_entries', inserted: 30, updated: 0, deleted: 0 },
        { table: 'journal_lines', inserted: 60, updated: 0, deleted: 0 },
      ]),
      op('counterparty.create', [{ table: 'counterparties', inserted: 1, updated: 0, deleted: 0 }]),
      op('account.merge', [
        { table: 'journal_lines', inserted: 0, updated: 120, deleted: 0 },
        { table: 'account_merge_log', inserted: 1, updated: 0, deleted: 0 },
      ]),
    ])

    expect(result.journalEntries).toBe(30)
    expect(result.masters).toBe(1)
  })

  it('仕訳の明細(journal_lines)だけが変わる操作(科目統合など)も、仕訳の影響として数える', () => {
    const result = summarizeImpact([
      op('account.merge', [{ table: 'journal_lines', inserted: 0, updated: 3, deleted: 0 }]),
    ])

    expect(result.journalEntries).toBe(0)
    expect(result.journalLines).toBe(3)
  })
})

describe('describeUndoSteps', () => {
  it('追加は削除、変更は元に戻す、削除は復元として、表ごとに件数つきで返す', () => {
    const steps = describeUndoSteps(
      op('x', [
        { table: 'journal_entries', inserted: 1, updated: 0, deleted: 0 },
        { table: 'counterparties', inserted: 0, updated: 2, deleted: 0 },
        { table: 'projects', inserted: 0, updated: 0, deleted: 3 },
      ]),
    )

    expect(steps).toEqual([
      { table: 'journal_entries', action: 'remove', count: 1 },
      { table: 'counterparties', action: 'revert', count: 2 },
      { table: 'projects', action: 'restore', count: 3 },
    ])
  })

  it('1つの表で追加と変更が混ざっていれば、動作ごとに別の行にする', () => {
    const steps = describeUndoSteps(
      op('x', [{ table: 'journal_lines', inserted: 2, updated: 1, deleted: 0 }]),
    )

    expect(steps.map((s) => s.action)).toEqual(['remove', 'revert'])
  })
})
