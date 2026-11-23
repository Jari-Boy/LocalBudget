/**
 * buildLineExpenseSplittingJournalEntryInput(行単位の割勘で、分担相手1人分の割勘仕訳を組み立てる純粋関数、
 * 計画Issue #271)のユニットテスト。借方の行(費用が増える向き)と貸方の行(返金・値引き・収益。逆向き)の
 * 付け替え、未収金・未払金の純額での1行化、世帯外の相手の仕訳、元の行idの記録、貸借の一致を検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import { buildLineExpenseSplittingJournalEntryInput } from './buildLineExpenseSplittingJournalEntryInput'

const FOOD = 10
const INCOME = 11
const ASSET = 90
const LIABILITY = 91
const PAYER = 1
const PARTNER = 2

const base = {
  advanceAssetAccountId: ASSET,
  advanceLiabilityAccountId: LIABILITY,
  settlementBatchId: 5,
  entryDate: '2026-11-23',
  memo: '割勘',
}

function balanced(input: CreateJournalEntryInput): boolean {
  const sum = (side: 'debit' | 'credit') => input.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0)
  return sum('debit') === sum('credit')
}

describe('buildLineExpenseSplittingJournalEntryInput', () => {
  it('世帯メンバーへの借方の行の割勘は、費用を相手へ付け替え、立替金(資産)と未払金(負債)を発生させる', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [{ sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 500, payerMemberId: PAYER }],
    })
    expect(input.sourceType).toBe('expense_splitting')
    expect(input.expenseSplitSourceLineIds).toEqual([100])
    expect(input.lines).toEqual([
      { accountId: FOOD, householdMemberId: PARTNER, projectId: null, side: 'debit', amount: 500 },
      { accountId: FOOD, householdMemberId: PAYER, projectId: null, side: 'credit', amount: 500 },
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'debit', amount: 500 },
      { accountId: LIABILITY, householdMemberId: PARTNER, settlementBatchId: 5, side: 'credit', amount: 500 },
    ])
  })

  it('貸方の行(返金・収益)の割勘は、付け替えも立替金・未払金も逆向きになる', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [{ sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: -250, payerMemberId: PAYER }],
    })
    expect(input.lines).toEqual([
      { accountId: INCOME, householdMemberId: PAYER, projectId: null, side: 'debit', amount: 250 },
      { accountId: INCOME, householdMemberId: PARTNER, projectId: null, side: 'credit', amount: 250 },
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'credit', amount: 250 },
      { accountId: LIABILITY, householdMemberId: PARTNER, settlementBatchId: 5, side: 'debit', amount: 250 },
    ])
  })

  it('借方と貸方の行を一緒に割ると、立替金・未払金は純額の1行ずつにまとめ、付け替えは行ごとに残す', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 1200, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: -250, payerMemberId: PAYER },
      ],
    })
    expect(input.expenseSplitSourceLineIds).toEqual([100, 101])
    const advance = input.lines.filter((l) => l.settlementBatchId === 5)
    expect(advance).toEqual([
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'debit', amount: 950 },
      { accountId: LIABILITY, householdMemberId: PARTNER, settlementBatchId: 5, side: 'credit', amount: 950 },
    ])
    expect(input.lines).toHaveLength(6)
    expect(balanced(input)).toBe(true)
  })

  it('純額が負なら、立替金(資産)は貸方・未払金(負債)は借方になる', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 100, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: -400, payerMemberId: PAYER },
      ],
    })
    const advance = input.lines.filter((l) => l.settlementBatchId === 5)
    expect(advance).toEqual([
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'credit', amount: 300 },
      { accountId: LIABILITY, householdMemberId: PARTNER, settlementBatchId: 5, side: 'debit', amount: 300 },
    ])
    expect(balanced(input)).toBe(true)
  })

  it('純額が0なら、立替金・未払金の行は作らない', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 300, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: -300, payerMemberId: PAYER },
      ],
    })
    expect(input.lines.some((l) => l.settlementBatchId === 5)).toBe(false)
    expect(balanced(input)).toBe(true)
  })

  it('世帯外の相手には、立替金(資産)と費用・収益の行(取引先付き)だけの仕訳にする', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'counterparty', counterpartyId: 7 },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: 3, signedAmount: 500, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: -200, payerMemberId: PAYER },
      ],
    })
    expect(input.lines).toEqual([
      { accountId: FOOD, householdMemberId: PAYER, counterpartyId: 7, projectId: 3, side: 'credit', amount: 500 },
      { accountId: INCOME, householdMemberId: PAYER, counterpartyId: 7, projectId: null, side: 'debit', amount: 200 },
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'debit', amount: 300 },
    ])
    expect(balanced(input)).toBe(true)
  })

  it('配分が0円の行は仕訳に含めず、元の行idにも記録しない', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 500, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: INCOME, projectId: null, signedAmount: 0, payerMemberId: PAYER },
      ],
    })
    expect(input.expenseSplitSourceLineIds).toEqual([100])
  })

  it('立替者が行ごとに違うときは、立替金(資産)を立替者ごとの純額で作り、未払金(負債)は相手の純額1行にする', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [
        { sourceLineId: 100, accountId: FOOD, projectId: null, signedAmount: 500, payerMemberId: PAYER },
        { sourceLineId: 101, accountId: FOOD, projectId: null, signedAmount: -200, payerMemberId: 3 },
      ],
    })
    expect(input.householdMemberId).toBe(PAYER)
    const advance = input.lines.filter((l) => l.settlementBatchId === 5)
    expect(advance).toEqual([
      { accountId: ASSET, householdMemberId: PAYER, settlementBatchId: 5, side: 'debit', amount: 500 },
      { accountId: ASSET, householdMemberId: 3, settlementBatchId: 5, side: 'credit', amount: 200 },
      { accountId: LIABILITY, householdMemberId: PARTNER, settlementBatchId: 5, side: 'credit', amount: 300 },
    ])
    expect(balanced(input)).toBe(true)
  })

  it('プロジェクト(イベント)は付け替えの費用・収益の行に引き継ぐ', () => {
    const input = buildLineExpenseSplittingJournalEntryInput({
      ...base,
      recipient: { kind: 'householdMember', toMemberId: PARTNER },
      shares: [{ sourceLineId: 100, accountId: FOOD, projectId: 3, signedAmount: 500, payerMemberId: PAYER }],
    })
    expect(input.lines.filter((l) => l.accountId === FOOD).map((l) => l.projectId)).toEqual([3, 3])
  })
})
