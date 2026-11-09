/**
 * calculateSettlementBatchBalance(精算バッチの未精算残高の集計)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md の「(settlement_batch_id, account_id, household_member_id または
 * counterparty_id)でグルーピングした集計方式」(計画Issue #133)を、資産型・負債型それぞれの
 * 増加側判定・無関係な行の除外・複数行の合算を含めて検証する。journal_entry_linksのような
 * 明示的なリンクを使わない、DB非依存・外部依存なしの純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import { calculateSettlementBatchBalance } from './calculateSettlementBatchBalance'

const BATCH_ID = 1
const ACCOUNT_ID = 10
const MEMBER_ID = 100

function buildLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'id' | 'amount' | 'side'>): JournalLine {
  return {
    journalEntryId: 1,
    accountId: ACCOUNT_ID,
    projectId: null,
    householdMemberId: MEMBER_ID,
    counterpartyId: null,
    settlementBatchId: BATCH_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('calculateSettlementBatchBalance', () => {
  it('資産型は、増加側(debit)の合計から減少側(credit)の合計を引いた値を返す', () => {
    const lines = [
      buildLine({ id: 1, amount: 3000, side: 'debit' }),
      buildLine({ id: 2, amount: 1000, side: 'credit' }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(2000)
  })

  it('負債型は、増加側(credit)の合計から減少側(debit)の合計を引いた値を返す', () => {
    const lines = [
      buildLine({ id: 1, amount: 3000, side: 'credit' }),
      buildLine({ id: 2, amount: 1000, side: 'debit' }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'liability', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(2000)
  })

  it('完済(消込済み)の場合は0を返す', () => {
    const lines = [
      buildLine({ id: 1, amount: 3000, side: 'debit' }),
      buildLine({ id: 2, amount: 3000, side: 'credit' }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(0)
  })

  it('過剰消込の場合はマイナスを返す(DB制約としては禁止しない、docs/domain/settlement.md 1.6)', () => {
    const lines = [
      buildLine({ id: 1, amount: 1000, side: 'debit' }),
      buildLine({ id: 2, amount: 1500, side: 'credit' }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(-500)
  })

  it('異なるsettlement_batch_id・account_id・household_member_idの行は合算に含めない', () => {
    const lines = [
      buildLine({ id: 1, amount: 3000, side: 'debit' }),
      buildLine({ id: 2, amount: 999, side: 'debit', settlementBatchId: 999 }),
      buildLine({ id: 3, amount: 999, side: 'debit', accountId: 999 }),
      buildLine({ id: 4, amount: 999, side: 'debit', householdMemberId: 999 }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(3000)
  })

  it('同一仕訳内に資産型・負債型の一時勘定行が両方あっても、対象科目以外の行(household_member_idが異なる)は混入しない', () => {
    const lines = [
      buildLine({ id: 1, amount: 500, side: 'debit', householdMemberId: MEMBER_ID }),
      buildLine({ id: 2, amount: 500, side: 'credit', accountId: 20, householdMemberId: 200 }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(500)
  })

  it('counterparty_idで対象を絞り込める(世帯外の相手の立替金は立て替えた世帯メンバーのhousehold_member_idで区別するため、通常はnull同士の一致で絞り込まれる)', () => {
    const lines = [
      buildLine({ id: 1, amount: 500, side: 'debit', counterpartyId: null }),
      buildLine({ id: 2, amount: 999, side: 'debit', householdMemberId: 1, counterpartyId: 5 }),
    ]

    const balance = calculateSettlementBatchBalance(lines, 'asset', {
      settlementBatchId: BATCH_ID,
      accountId: ACCOUNT_ID,
      householdMemberId: MEMBER_ID,
      counterpartyId: null,
    })

    expect(balance).toBe(500)
  })
})
