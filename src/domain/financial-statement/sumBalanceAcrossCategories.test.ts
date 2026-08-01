/**
 * sumBalanceAcrossCategories(区分をまたいだ軸集計エンジン)の純粋関数としてのユニットテスト。
 * 取引先別・世帯メンバー別集計(docs/domain/counterparties.md 1.7節・
 * docs/domain/household-members.md 1.4節)は「区分に応じて符号反転」した金額を合算する。
 * 明細ごとに紐づく科目の区分を判定し、区分単位でcalculateAccountBalanceの残高計算式を
 * 適用してから合算する、軸(取引先・世帯メンバー等)非依存の汎用集計ロジックを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import { sumBalanceAcrossCategories } from './sumBalanceAcrossCategories'

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    category: 'expense',
    name: 'テスト科目',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('sumBalanceAcrossCategories', () => {
  it('単一区分(費用)の明細のみの場合はcalculateAccountBalanceと同じ結果になる', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, category: 'expense' })]])

    expect(
      sumBalanceAcrossCategories(
        [
          { accountId: 1, side: 'debit', amount: 3000 },
          { accountId: 1, side: 'credit', amount: 1000 },
        ],
        accountsById,
      ),
    ).toBe(2000)
  })

  it('複数区分(費用・収益)にまたがる明細は区分ごとに残高計算してから合算する', () => {
    const accountsById = new Map([
      [1, buildAccount({ id: 1, category: 'expense' })],
      [2, buildAccount({ id: 2, category: 'revenue' })],
    ])

    // 費用: debit-credit = 5000-0 = 5000, 収益: credit-debit = 2000-0 = 2000, 合計7000
    expect(
      sumBalanceAcrossCategories(
        [
          { accountId: 1, side: 'debit', amount: 5000 },
          { accountId: 2, side: 'credit', amount: 2000 },
        ],
        accountsById,
      ),
    ).toBe(7000)
  })

  it('同一科目に複数明細がある場合は同一区分グループとして合算してから残高計算する', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, category: 'expense' })]])

    expect(
      sumBalanceAcrossCategories(
        [
          { accountId: 1, side: 'debit', amount: 1000 },
          { accountId: 1, side: 'debit', amount: 2000 },
          { accountId: 1, side: 'credit', amount: 500 },
        ],
        accountsById,
      ),
    ).toBe(2500)
  })

  it('明細が0件の場合は0を返す', () => {
    expect(sumBalanceAcrossCategories([], new Map())).toBe(0)
  })
})
