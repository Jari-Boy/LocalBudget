/**
 * summarizeAccountRegistration(計画Issue #189)のユニットテスト。
 * 資産・負債科目の右パネルに出す「登録時の設定」を、科目から求める純粋関数を検証する。
 * 照合可否(is_reconcilable)から残高情報の有無を求める。資産・負債以外は対象外(null)。
 * 初期残高は「最初の基準点」として残高の照合欄に統合したため、ここでは扱わない(計画Issue #205)。
 * 外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from './Account'
import { summarizeAccountRegistration } from './summarizeAccountRegistration'

const account = (overrides: Partial<Account>): Account => ({
  id: 1,
  category: 'asset',
  name: '銀行',
  isReconcilable: true,
  hasExternalStatement: true,
  isActive: true,
  isSystemManaged: false,
  autoBalanceAdjustment: true,
  householdMemberId: null,
  accountGroupId: null,
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
  ...overrides,
})

describe('summarizeAccountRegistration', () => {
  it('照合可否がtrueの科目は、残高情報ありと求まる', () => {
    expect(summarizeAccountRegistration(account({ isReconcilable: true }))?.hasBalanceInfo).toBe(true)
  })

  it('照合可否がfalseの科目は、残高情報なしと求まる', () => {
    expect(summarizeAccountRegistration(account({ isReconcilable: false }))?.hasBalanceInfo).toBe(false)
  })

  it('外部明細の有無は、登録時の回答(hasExternalStatement)をそのまま返す(CSVあり・残高なしも区別できる)', () => {
    expect(
      summarizeAccountRegistration(account({ isReconcilable: false, hasExternalStatement: true }))
        ?.hasExternalStatement,
    ).toBe(true)
    expect(
      summarizeAccountRegistration(account({ isReconcilable: false, hasExternalStatement: false }))
        ?.hasExternalStatement,
    ).toBe(false)
  })

  it('回答が未記録(null)の行は、照合可否から推定する(照合する科目は外部明細あり)', () => {
    expect(
      summarizeAccountRegistration(account({ isReconcilable: true, hasExternalStatement: null }))
        ?.hasExternalStatement,
    ).toBe(true)
    expect(
      summarizeAccountRegistration(account({ isReconcilable: false, hasExternalStatement: null }))
        ?.hasExternalStatement,
    ).toBe(false)
  })

  it('資産・負債以外の科目は対象外としてnullを返す', () => {
    expect(summarizeAccountRegistration(account({ category: 'expense', isReconcilable: null }))).toBeNull()
    expect(summarizeAccountRegistration(account({ category: 'equity', isReconcilable: null }))).toBeNull()
  })
})
