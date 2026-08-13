/**
 * resolveEffectiveHouseholdMemberId(実効メンバーの解決)の純粋関数としてのユニットテスト。
 * 計画Issue #88で改訂された新ロジック(docs/domain/household-members.md 1.2節)
 * 「科目に既定値があれば強制、無ければ明細の上書き可→(明細も未設定なら)ヘッダーの起票者」
 * を、科目既定値の有無・明細指定の有無の組み合わせを含め検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import { resolveEffectiveHouseholdMemberId } from './resolveEffectiveHouseholdMemberId'

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    category: 'asset',
    name: 'テスト口座',
    isReconcilable: true,
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

describe('resolveEffectiveHouseholdMemberId', () => {
  it('科目に既定値がある場合、明細側の指定によらず科目の既定値を返す(強制)', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: 10 })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: 20 }, accountsById, 30),
    ).toBe(10)
  })

  it('科目に既定値があり明細がnullの場合も科目の既定値を返す', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: 10 })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: null }, accountsById, 30),
    ).toBe(10)
  })

  it('科目に既定値が無く明細に指定がある場合はその値を返す(上書き)', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: null })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: 20 }, accountsById, 30),
    ).toBe(20)
  })

  it('科目に既定値が無く明細もnullの場合はヘッダーの起票者にフォールバックする', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: null })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: null }, accountsById, 30),
    ).toBe(30)
  })

  it('該当する科目がaccountsByIdに存在しない場合は科目既定値なしとして扱い、明細→起票者の順にフォールバックする', () => {
    const accountsById = new Map<number, Account>()

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 999, householdMemberId: null }, accountsById, 30),
    ).toBe(30)
    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 999, householdMemberId: 20 }, accountsById, 30),
    ).toBe(20)
  })
})
