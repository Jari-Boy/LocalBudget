/**
 * resolveLastConfirmedLines(金額の初期値が「前回確定額」のルールの、行ごとの金額の決め方)の
 * 純粋関数としてのユニットテスト。計画Issue #180の決定「前回の仕訳の行と、科目と借方/貸方の組で
 * 対応づけ、一致した行の金額を引き継ぐ。一致しない行はルールの金額を使う」を検証する。
 * 外部依存なし(DB非依存)。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRuleLine } from './RecurringTransactionRule'
import { resolveLastConfirmedLines } from './resolveLastConfirmedLines'

function ruleLine(overrides: Partial<RecurringTransactionRuleLine>): RecurringTransactionRuleLine {
  return {
    lineNo: 1,
    side: 'debit',
    accountId: 10,
    amount: 1000,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    ...overrides,
  }
}

describe('resolveLastConfirmedLines', () => {
  it('科目と借方/貸方が一致する行は、前回の金額を引き継ぐ', () => {
    const lines = [ruleLine({ lineNo: 1, side: 'debit', accountId: 10 }), ruleLine({ lineNo: 2, side: 'credit', accountId: 20 })]

    const result = resolveLastConfirmedLines(lines, [
      { accountId: 10, side: 'debit', amount: 1200 },
      { accountId: 20, side: 'credit', amount: 1200 },
    ])

    expect(result.map((l) => l.amount)).toEqual([1200, 1200])
  })

  it('一致しない行は、ルールの金額を使う(前回に手で足した行は引き継がない)', () => {
    const lines = [ruleLine({ lineNo: 1, side: 'debit', accountId: 10, amount: 1000 }), ruleLine({ lineNo: 2, side: 'credit', accountId: 20, amount: 1000 })]

    const result = resolveLastConfirmedLines(lines, [
      { accountId: 10, side: 'debit', amount: 1500 },
      { accountId: 99, side: 'debit', amount: 300 },
      { accountId: 20, side: 'credit', amount: 1800 },
    ])

    expect(result.map((l) => l.amount)).toEqual([1500, 1800])
  })

  it('科目が同じでも借方/貸方が違えば一致とみなさない', () => {
    const result = resolveLastConfirmedLines([ruleLine({ side: 'debit', accountId: 10, amount: 1000 })], [
      { accountId: 10, side: 'credit', amount: 5000 },
    ])

    expect(result[0].amount).toBe(1000)
  })

  it('同じ科目・同じ側の行が複数あるときは、出現順に1対1で対応づける', () => {
    const lines = [
      ruleLine({ lineNo: 1, side: 'debit', accountId: 10, amount: 100 }),
      ruleLine({ lineNo: 2, side: 'debit', accountId: 10, amount: 200 }),
    ]

    const result = resolveLastConfirmedLines(lines, [
      { accountId: 10, side: 'debit', amount: 111 },
      { accountId: 10, side: 'debit', amount: 222 },
    ])

    expect(result.map((l) => l.amount)).toEqual([111, 222])
  })

  it('前回の仕訳が無い(空)ときは、すべてルールの金額のまま返す', () => {
    const lines = [ruleLine({ amount: 700 })]

    expect(resolveLastConfirmedLines(lines, []).map((l) => l.amount)).toEqual([700])
  })

  it('金額以外の項目と行番号は変えずに返す', () => {
    const result = resolveLastConfirmedLines([ruleLine({ lineNo: 3, projectId: 5, counterpartyId: 6 })], [
      { accountId: 10, side: 'debit', amount: 9 },
    ])

    expect(result[0]).toMatchObject({ lineNo: 3, projectId: 5, counterpartyId: 6, amount: 9 })
  })
})
