/**
 * CSV取込レビュー画面(計画Issue #76)の対象科目選択で、選択肢に出してよい科目かどうかを
 * 判定するisStatementImportEligibleAccountのユニットテスト。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { isStatementImportEligibleAccount } from './statementImportEligibility'

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
