/**
 * isSettlementBatchBalanceZero(精算バッチの非アクティブ化提案の判定ロジック)のユニットテスト。
 * docs/domain/projects.md 1.3節・1.5節の非アクティブ化提案の判定を、project(kind='settlement')
 * からsettlement_batchesへ移設したもの(計画Issue #133)。紐づく資産・負債科目それぞれについて
 * calculateSettlementBatchBalanceを適用し、すべての残高が0になった状態を検出することを検証する。
 * DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { isSettlementBatchBalanceZero } from './isSettlementBatchBalanceZero'

const BATCH_ID = 1
const ASSET_ACCOUNT_ID = 10
const LIABILITY_ACCOUNT_ID = 20

function buildBatch(overrides: Partial<SettlementBatch> = {}): SettlementBatch {
  return {
    id: BATCH_ID,
    name: '6月生活費',
    type: 'expense_splitting',
    counterpartyId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const accounts: Account[] = [
  { id: ASSET_ACCOUNT_ID, name: '立替金', category: 'asset', isReconcilable: false, isSystemManaged: true },
  { id: LIABILITY_ACCOUNT_ID, name: '立替金(負債)', category: 'liability', isReconcilable: false, isSystemManaged: true },
] as Account[]

function buildLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'id' | 'amount' | 'side' | 'accountId'>): JournalLine {
  return {
    journalEntryId: 1,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: BATCH_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isSettlementBatchBalanceZero', () => {
  it('紐づく資産・負債科目の残高がすべて0ならtrueを返す', () => {
    const lines = [
      buildLine({ id: 1, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'debit' }),
      buildLine({ id: 2, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'credit' }),
    ]

    expect(isSettlementBatchBalanceZero(buildBatch(), lines, accounts)).toBe(true)
  })

  it('残高が残っている科目が1つでもあればfalseを返す', () => {
    const lines = [buildLine({ id: 1, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'debit' })]

    expect(isSettlementBatchBalanceZero(buildBatch(), lines, accounts)).toBe(false)
  })

  it('資産側が完済でも負債側に残高が残っていればfalseを返す(世帯メンバー間の割勘、docs/domain/settlement.md参照)', () => {
    const lines = [
      buildLine({ id: 1, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'debit' }),
      buildLine({ id: 2, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'credit' }),
      buildLine({ id: 3, accountId: LIABILITY_ACCOUNT_ID, amount: 500, side: 'credit' }),
    ]

    expect(isSettlementBatchBalanceZero(buildBatch(), lines, accounts)).toBe(false)
  })

  it('紐づく資産・負債科目の明細が1件もない(未記帳)場合はfalseを返す', () => {
    expect(isSettlementBatchBalanceZero(buildBatch(), [], accounts)).toBe(false)
  })

  it('他のバッチの明細行は対象に含めない', () => {
    const lines = [buildLine({ id: 1, accountId: ASSET_ACCOUNT_ID, amount: 500, side: 'debit', settlementBatchId: 999 })]

    expect(isSettlementBatchBalanceZero(buildBatch(), lines, accounts)).toBe(false)
  })
})
