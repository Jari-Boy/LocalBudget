/**
 * isSettlementBatchTaggableAccount(計画Issue #144、#167で対象を絞り込み)のユニットテスト。
 * 精算バッチのタグ(settlement_batch_id)を設定できる明細行の科目かどうか、すなわち
 * 割勘の一時勘定(seedAdvanceAccountsが投入するシステム管理の立替金・未払金、
 * docs/domain/settlement.md 1.7)かどうかの判定を検証する。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { isSettlementBatchTaggableAccount } from './isSettlementBatchTaggableAccount'

describe('isSettlementBatchTaggableAccount', () => {
  it('システム管理の資産科目(立替金)はtrueを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'asset', isSystemManaged: true })).toBe(true)
  })

  it('システム管理の負債科目(未払金)はtrueを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'liability', isSystemManaged: true })).toBe(true)
  })

  it('利用者が作った資産・負債科目(未収金・カードの未払金・普通預金等)はfalseを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'asset', isSystemManaged: false })).toBe(false)
    expect(isSettlementBatchTaggableAccount({ category: 'liability', isSystemManaged: false })).toBe(false)
  })

  it('システム管理でも純資産科目(初期残高)はfalseを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'equity', isSystemManaged: true })).toBe(false)
  })

  it('収益・費用科目はfalseを返す', () => {
    expect(isSettlementBatchTaggableAccount({ category: 'expense', isSystemManaged: false })).toBe(false)
    expect(isSettlementBatchTaggableAccount({ category: 'revenue', isSystemManaged: false })).toBe(false)
  })
})
