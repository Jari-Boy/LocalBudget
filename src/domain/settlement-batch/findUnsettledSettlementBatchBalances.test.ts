/**
 * findUnsettledSettlementBatchBalances(精算バッチ内の未精算残高一覧)の純粋関数としてのユニット
 * テスト。指定した精算バッチ・科目に一致する明細行を世帯メンバー/取引先ごとにグルーピングし、
 * calculateSettlementBatchBalanceで残高を求め、残高が0より大きいものだけを返すこと(計画Issue #133)を
 * 検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import { findUnsettledSettlementBatchBalances } from './findUnsettledSettlementBatchBalances'

const BATCH_ID = 1
const ACCOUNT_ID = 10

function buildLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'id' | 'amount' | 'side'>): JournalLine {
  return {
    journalEntryId: 1,
    accountId: ACCOUNT_ID,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: BATCH_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('findUnsettledSettlementBatchBalances', () => {
  it('残高が0より大きいグループのみを返す', () => {
    const lines = [
      buildLine({ id: 1, amount: 1000, side: 'debit', householdMemberId: 1 }),
      buildLine({ id: 2, amount: 1000, side: 'credit', householdMemberId: 2 }), // 完済済み(合わせて0になる別グループ)
    ]

    const result = findUnsettledSettlementBatchBalances(lines, BATCH_ID, ACCOUNT_ID, 'asset')

    expect(result).toEqual([{ householdMemberId: 1, counterpartyId: null, balance: 1000 }])
  })

  it('世帯メンバーが異なる一時勘定行は別グループとして区別する', () => {
    const lines = [
      buildLine({ id: 1, amount: 600, side: 'debit', householdMemberId: 1 }),
      buildLine({ id: 2, amount: 400, side: 'debit', householdMemberId: 2 }),
    ]

    const result = findUnsettledSettlementBatchBalances(lines, BATCH_ID, ACCOUNT_ID, 'asset')

    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { householdMemberId: 1, counterpartyId: null, balance: 600 },
        { householdMemberId: 2, counterpartyId: null, balance: 400 },
      ]),
    )
  })

  it('完済(残高0)のグループは含めない', () => {
    const lines = [
      buildLine({ id: 1, amount: 500, side: 'debit', householdMemberId: 1 }),
      buildLine({ id: 2, amount: 500, side: 'credit', householdMemberId: 1 }),
    ]

    const result = findUnsettledSettlementBatchBalances(lines, BATCH_ID, ACCOUNT_ID, 'asset')

    expect(result).toEqual([])
  })

  it('対象外の精算バッチ・科目の行は候補に含めない', () => {
    const lines = [
      buildLine({ id: 1, amount: 500, side: 'debit', householdMemberId: 1, settlementBatchId: 999 }),
      buildLine({ id: 2, amount: 500, side: 'debit', householdMemberId: 1, accountId: 999 }),
    ]

    const result = findUnsettledSettlementBatchBalances(lines, BATCH_ID, ACCOUNT_ID, 'asset')

    expect(result).toEqual([])
  })

  it('settlement_batch_idが未設定の行は候補に含めない', () => {
    const lines = [buildLine({ id: 1, amount: 500, side: 'debit', householdMemberId: 1, settlementBatchId: null })]

    const result = findUnsettledSettlementBatchBalances(lines, BATCH_ID, ACCOUNT_ID, 'asset')

    expect(result).toEqual([])
  })
})
