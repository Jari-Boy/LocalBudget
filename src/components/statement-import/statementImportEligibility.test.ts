/**
 * CSV取込レビュー画面(計画Issue #76)の科目選択で、選択肢に出してよい科目かどうかを
 * 判定するisStatementImportEligibleAccount(対象科目選択)・
 * isStatementImportCounterAccountEligible(相手科目選択)のユニットテスト。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  isStatementImportCounterAccountEligible,
  isStatementImportEligibleAccount,
  isStatementImportSettlementBatchAccount,
} from './statementImportEligibility'

function account(overrides: Partial<Parameters<typeof isStatementImportEligibleAccount>[0]> = {}) {
  return {
    category: 'asset' as const,
    isActive: true,
    isSystemManaged: false,
    ...overrides,
  }
}

describe('isStatementImportEligibleAccount', () => {
  it('アクティブなasset科目は候補になる(銀行口座・電子マネー・証券投資口座)', () => {
    expect(isStatementImportEligibleAccount(account({ category: 'asset' }))).toBe(true)
  })

  it('アクティブなliability科目は候補になる(クレジットカード専用未払金)', () => {
    expect(isStatementImportEligibleAccount(account({ category: 'liability' }))).toBe(true)
  })

  it('equity/revenue/expense科目は候補にならない', () => {
    expect(isStatementImportEligibleAccount(account({ category: 'equity' }))).toBe(false)
    expect(isStatementImportEligibleAccount(account({ category: 'revenue' }))).toBe(false)
    expect(isStatementImportEligibleAccount(account({ category: 'expense' }))).toBe(false)
  })

  it('非アクティブな科目は候補にならない', () => {
    expect(isStatementImportEligibleAccount(account({ isActive: false }))).toBe(false)
  })

  it('システム管理科目(初期残高科目・残高調整科目等)は候補にならない', () => {
    expect(isStatementImportEligibleAccount(account({ isSystemManaged: true }))).toBe(false)
  })
})

const counter = (overrides: Partial<Parameters<typeof isStatementImportCounterAccountEligible>[0]> = {}) => ({
  category: 'expense' as const,
  isReconcilable: null,
  isSystemManaged: false,
  ...overrides,
})

describe('isStatementImportCounterAccountEligible', () => {
  it('is_reconcilable=true科目(銀行口座等)も相手科目の候補になる(口座間振替、external_importはis_reconcilable制限のホワイトリストに含まれる)', () => {
    expect(isStatementImportCounterAccountEligible(counter({ category: 'asset', isReconcilable: true }))).toBe(true)
  })

  it('システム管理科目のうち、割勘の一時勘定である立替金(資産)・未払金(負債)は相手科目の候補になる(計画Issue #151)', () => {
    expect(isStatementImportCounterAccountEligible(counter({ category: 'asset', isReconcilable: false, isSystemManaged: true }))).toBe(true)
    expect(isStatementImportCounterAccountEligible(counter({ category: 'liability', isReconcilable: false, isSystemManaged: true }))).toBe(true)
  })

  it('それ以外のシステム管理科目(初期残高・残高調整等)は相手科目の候補にならない', () => {
    expect(isStatementImportCounterAccountEligible(counter({ category: 'equity', isSystemManaged: true }))).toBe(false)
    expect(isStatementImportCounterAccountEligible(counter({ category: 'expense', isSystemManaged: true }))).toBe(false)
  })
})

describe('isStatementImportSettlementBatchAccount', () => {
  it('精算バッチを付けられるのは、システム管理の立替金(資産)・未払金(負債)だけ', () => {
    expect(isStatementImportSettlementBatchAccount(counter({ category: 'asset', isReconcilable: false, isSystemManaged: true }))).toBe(true)
    expect(isStatementImportSettlementBatchAccount(counter({ category: 'liability', isReconcilable: false, isSystemManaged: true }))).toBe(true)
  })

  it('利用者が作った資産・負債科目(有価証券など、照合しない科目を含む)には付けられない', () => {
    expect(isStatementImportSettlementBatchAccount(counter({ category: 'asset', isReconcilable: false }))).toBe(false)
    expect(isStatementImportSettlementBatchAccount(counter({ category: 'liability', isReconcilable: false }))).toBe(false)
    expect(isStatementImportSettlementBatchAccount(counter({ category: 'asset', isReconcilable: true }))).toBe(false)
  })
})
