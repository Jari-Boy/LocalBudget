/**
 * summarizeSettlementBatches(全バッチの集計を、明細行を1回の走査でバッチごとに振り分けて求める)と、
 * クローズの状態の判定(settlementBatchStatus)のユニットテスト。軽量化の前後で結果が一致すること
 * (バッチごとに全明細行を絞り込む従来の summarizeSettlementBatch と同じ結果になること)、
 * 「残高0でクローズ待ち」「クローズ済みなのに残高あり」の判定、精算済みの一覧の並び順
 * (残高ありを上位に)を検証する(計画Issue #249)。DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { countClosedWithBalance, isClosedWithBalance, isWaitingToClose, sortClosedWithBalanceFirst } from './settlementBatchStatus'
import { summarizeSettlementBatch } from './summarizeSettlementBatch'
import { summarizeSettlementBatches } from './summarizeSettlementBatches'

const ADVANCE_ID = 10
const PAYABLE_ID = 20

const accounts = [
  { id: ADVANCE_ID, name: '未収金(精算バッチ)', category: 'asset', isReconcilable: false, isSystemManaged: true },
  { id: PAYABLE_ID, name: '未払金(精算バッチ)', category: 'liability', isReconcilable: false, isSystemManaged: true },
  { id: 30, name: '食費', category: 'expense', isReconcilable: null, isSystemManaged: false },
] as Account[]

function batchOf(id: number, isActive = true): SettlementBatch {
  return { id, name: `バッチ${id}`, type: 'expense_splitting', counterpartyId: null, isActive, createdAt: '', updatedAt: '' }
}

let nextId = 1
function line(
  settlementBatchId: number | null,
  accountId: number,
  side: 'debit' | 'credit',
  amount: number,
  householdMemberId = 1,
): JournalLine {
  return { id: nextId++, journalEntryId: 1, projectId: null, householdMemberId, counterpartyId: null, settlementBatchId, accountId, side, amount, createdAt: '' }
}

describe('summarizeSettlementBatches', () => {
  const lines = [
    line(1, ADVANCE_ID, 'debit', 6000),
    line(1, ADVANCE_ID, 'credit', 6000),
    line(2, ADVANCE_ID, 'debit', 3000, 2),
    line(2, PAYABLE_ID, 'credit', 800),
    line(null, 30, 'debit', 500),
    line(4, PAYABLE_ID, 'credit', 100),
  ]
  const batches = [batchOf(1), batchOf(2), batchOf(3), batchOf(5, false)]

  it('バッチごとに全明細行を絞り込む従来の集計と、同じ結果になる', () => {
    const expected = batches.map((b) => summarizeSettlementBatch(b, lines, accounts))

    expect(summarizeSettlementBatches(batches, lines, accounts)).toEqual(expected)
  })

  it('バッチの並び順のまま返し、明細の無いバッチも含める', () => {
    const result = summarizeSettlementBatches(batches, lines, accounts)

    expect(result.map((s) => s.batch.id)).toEqual([1, 2, 3, 5])
    expect(result[2].hasLines).toBe(false)
  })
})

describe('settlementBatchStatus', () => {
  const summaryOf = (b: SettlementBatch, lines: JournalLine[]) => summarizeSettlementBatch(b, lines, accounts)
  const open = [line(1, ADVANCE_ID, 'debit', 100)]
  const zero = [line(1, ADVANCE_ID, 'debit', 100), line(1, ADVANCE_ID, 'credit', 100)]

  it('クローズされていなくて残高が0(明細あり)なら、クローズ待ちになる', () => {
    expect(isWaitingToClose(summaryOf(batchOf(1), zero))).toBe(true)
    expect(isWaitingToClose(summaryOf(batchOf(1, false), zero))).toBe(false)
  })

  it('明細が無いバッチ・残高が残っているバッチは、クローズ待ちにならない', () => {
    expect(isWaitingToClose(summaryOf(batchOf(1), []))).toBe(false)
    expect(isWaitingToClose(summaryOf(batchOf(1), open))).toBe(false)
  })

  it('クローズ済みで残高が残っているバッチは、クローズ済みなのに残高ありになる', () => {
    expect(isClosedWithBalance(summaryOf(batchOf(1, false), open))).toBe(true)
    expect(isClosedWithBalance(summaryOf(batchOf(1, false), zero))).toBe(false)
    expect(isClosedWithBalance(summaryOf(batchOf(1, true), open))).toBe(false)
  })

  it('クローズ済みなのに残高ありのバッチの数を数える', () => {
    const summaries = [
      summaryOf(batchOf(1, false), open),
      summaryOf(batchOf(2, false), zero),
      summaryOf(batchOf(3, true), open),
    ]

    expect(countClosedWithBalance(summaries)).toBe(1)
  })

  it('並べ替えでは、残高ありのバッチを先頭に出し、それ以外は元の並び順を保つ', () => {
    const a = summaryOf(batchOf(1, false), zero)
    const b = summaryOf(batchOf(2, false), [line(2, ADVANCE_ID, 'debit', 100)])
    const c = summaryOf(batchOf(3, false), [line(3, ADVANCE_ID, 'debit', 100), line(3, ADVANCE_ID, 'credit', 100)])

    expect(sortClosedWithBalanceFirst([a, b, c]).map((s) => s.batch.id)).toEqual([2, 1, 3])
  })
})
