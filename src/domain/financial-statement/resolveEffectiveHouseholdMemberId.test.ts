/**
 * resolveEffectiveHouseholdMemberId(実効メンバーの解決)の純粋関数としてのユニットテスト。
 * docs/domain/household-members.md 1.2節の
 * 「実効メンバー = COALESCE(journal_lines.household_member_id, accounts.household_member_id)」
 * という既定値継承ルールを、明細側指定あり・なし・両方NULL・科目未検出の境界値を含め検証する。
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
  it('明細側にhouseholdMemberIdが指定されている場合はそれを優先する(上書き)', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: 10 })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: 20 }, accountsById),
    ).toBe(20)
  })

  it('明細側がnullの場合は科目の既定値(accounts.householdMemberId)を継承する', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: 10 })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: null }, accountsById),
    ).toBe(10)
  })

  it('明細側・科目側ともにnullの場合は世帯共通としてnullを返す', () => {
    const accountsById = new Map([[1, buildAccount({ id: 1, householdMemberId: null })]])

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 1, householdMemberId: null }, accountsById),
    ).toBeNull()
  })

  it('該当する科目がaccountsByIdに存在しない場合はnullとして扱う', () => {
    const accountsById = new Map<number, Account>()

    expect(
      resolveEffectiveHouseholdMemberId({ accountId: 999, householdMemberId: null }, accountsById),
    ).toBeNull()
  })
})
