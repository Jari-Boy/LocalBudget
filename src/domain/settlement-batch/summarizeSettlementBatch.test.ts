/**
 * summarizeSettlementBatch(精算画面の精算バッチ一覧・方向カードに出す集計)のユニットテスト。
 * 同じ精算バッチの立替金(資産)と未払金(負債)の残高を、合算も相殺もせず別々に求めること、
 * 世帯メンバーごとの内訳、明細なし・精算済み(残高がすべて0で明細が1行以上)の判定を検証する
 * (docs/domain/settlement.md 1.9、計画Issue #153)。DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { summarizeSettlementBatch } from './summarizeSettlementBatch'

const BATCH_ID = 1
const ADVANCE_ID = 10
const PAYABLE_ID = 20

const batch: SettlementBatch = {
  id: BATCH_ID,
  name: '10月分 割勘(妻)',
  type: 'expense_splitting',
  counterpartyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const accounts = [
  { id: ADVANCE_ID, name: '立替金', category: 'asset', isReconcilable: false, isSystemManaged: true },
  { id: PAYABLE_ID, name: '未払金', category: 'liability', isReconcilable: false, isSystemManaged: true },
  { id: 30, name: '食費', category: 'expense', isReconcilable: null, isSystemManaged: false },
] as Account[]

let nextId = 1
function line(overrides: Partial<JournalLine> & Pick<JournalLine, 'accountId' | 'side' | 'amount'>): JournalLine {
  return {
    id: nextId++,
    journalEntryId: 1,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: BATCH_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('summarizeSettlementBatch', () => {
  it('立替金と未払金の残高を合算も相殺もせず別々に求める', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 }),
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 2500 }),
    ]

    const summary = summarizeSettlementBatch(batch, lines, accounts)

    expect(summary.advance).toMatchObject({ accountId: ADVANCE_ID, hasLines: true, balance: 6000 })
    expect(summary.payable).toMatchObject({ accountId: PAYABLE_ID, hasLines: true, balance: 2500 })
  })

  it('立替金は貸方、未払金は借方の行で残高が減る', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 }),
      line({ accountId: ADVANCE_ID, side: 'credit', amount: 2000 }),
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 3000 }),
      line({ accountId: PAYABLE_ID, side: 'debit', amount: 1000 }),
    ]

    const summary = summarizeSettlementBatch(batch, lines, accounts)

    expect(summary.advance?.balance).toBe(4000)
    expect(summary.payable?.balance).toBe(2000)
  })

  it('別のバッチのタグが付いた明細は集計に含めない', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 }),
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 9999, settlementBatchId: 2 }),
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 8888, settlementBatchId: null }),
    ]

    expect(summarizeSettlementBatch(batch, lines, accounts).advance?.balance).toBe(6000)
  })

  it('その科目の明細が無い方向は hasLines が false で残高は0になる', () => {
    const lines = [line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 })]

    const summary = summarizeSettlementBatch(batch, lines, accounts)

    expect(summary.payable).toMatchObject({ hasLines: false, balance: 0, breakdown: [] })
  })

  it('世帯メンバーごとの内訳を返し、世帯メンバーの無い行は householdMemberId が null になる', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 5000, householdMemberId: 2 }),
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 1000, householdMemberId: 2 }),
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 700, householdMemberId: null }),
    ]

    const summary = summarizeSettlementBatch(batch, lines, accounts)

    expect(summary.advance?.breakdown).toEqual([
      { householdMemberId: 2, balance: 6000 },
      { householdMemberId: null, balance: 700 },
    ])
  })

  it('明細が1行も無いバッチは精算済みにならない', () => {
    const summary = summarizeSettlementBatch(batch, [], accounts)

    expect(summary).toMatchObject({ hasLines: false, isSettled: false })
  })

  it('(科目, 世帯メンバー)の組ごとの残高がすべて0なら精算済みになる', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 }),
      line({ accountId: ADVANCE_ID, side: 'credit', amount: 6000 }),
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 100, householdMemberId: 2 }),
      line({ accountId: PAYABLE_ID, side: 'debit', amount: 100, householdMemberId: 2 }),
    ]

    expect(summarizeSettlementBatch(batch, lines, accounts)).toMatchObject({ hasLines: true, isSettled: true })
  })

  it('世帯外の相手のバッチは、方向ごとの合計が0なら精算済みになる(精算の行は世帯メンバーを持たないため)', () => {
    const counterpartyBatch = { ...batch, counterpartyId: 9 }
    const lines = [
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 4000, householdMemberId: 1 }),
      line({ accountId: PAYABLE_ID, side: 'debit', amount: 4000, householdMemberId: null }),
    ]

    expect(summarizeSettlementBatch(counterpartyBatch, lines, accounts)).toMatchObject({
      payable: { balance: 0 },
      isSettled: true,
    })
  })

  it('片方の方向に明細が無くても、もう一方の残高が0なら精算済みになる', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 3000 }),
      line({ accountId: ADVANCE_ID, side: 'credit', amount: 3000 }),
    ]

    expect(summarizeSettlementBatch(batch, lines, accounts)).toMatchObject({ payable: { hasLines: false }, isSettled: true })
  })

  it('合計が0でも組ごとに残高が残っていれば精算済みにならない', () => {
    const lines = [
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 500, householdMemberId: 1 }),
      line({ accountId: ADVANCE_ID, side: 'credit', amount: 500, householdMemberId: 2 }),
    ]

    const summary = summarizeSettlementBatch(batch, lines, accounts)

    expect(summary.advance?.balance).toBe(0)
    expect(summary.isSettled).toBe(false)
  })
})
