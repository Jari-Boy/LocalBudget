/**
 * isSettlementBatchTaggableAccount(計画Issue #144)のユニットテスト。
 * 精算バッチのタグ(settlement_batch_id)を設定できる明細行の科目かどうか、すなわち
 * 一時勘定(is_reconcilable = falseの資産・負債科目、立替金・未払金・未収金等、
 * docs/domain/settlement.md 1.4)かどうかの判定を検証する。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { isSettlementBatchTaggableAccount } from './isSettlementBatchTaggableAccount'

describe('isSettlementBatchTaggableAccount', () => {
  it('is_reconcilable = falseの資産科目(立替金・未収金)はtrueを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'asset', isReconcilable: false })).toBe(true)
  })

  it('is_reconcilable = falseの負債科目(未払金)はtrueを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'liability', isReconcilable: false })).toBe(true)
  })

  it('is_reconcilable = trueの口座科目(普通預金等)はfalseを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'asset', isReconcilable: true })).toBe(false)
    expect(isSettlementBatchTaggableAccount({ category: 'liability', isReconcilable: true })).toBe(false)
  })

  it('収益・費用・純資産科目はfalseを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'expense', isReconcilable: null })).toBe(false)
    expect(isSettlementBatchTaggableAccount({ category: 'revenue', isReconcilable: null })).toBe(false)
    expect(isSettlementBatchTaggableAccount({ category: 'equity', isReconcilable: null })).toBe(false)
  })
})
