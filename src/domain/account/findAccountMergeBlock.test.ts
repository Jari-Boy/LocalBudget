/**
 * findAccountMergeBlock(計画Issue #97)のユニットテスト。
 * 複数の勘定科目を統合できるか(docs/domain/accounts.md 2.2)の判定 — システム管理科目を含む、
 * 区分が異なる、照合可否が異なる、のいずれかなら理由を返し、統合できるなら null を返す —
 * を検証する。SqlJsAccountRepository.merge の拒否条件と同じ規則。外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from './Account'
import { findAccountMergeBlock } from './findAccountMergeBlock'

function account(overrides: Partial<Account>): Account {
  return {
    id: 1,
    category: 'expense',
    name: '交通費',
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('findAccountMergeBlock', () => {
  it('同じ区分・同じ照合可否の通常の科目同士なら、統合できる(null)', () => {
    expect(findAccountMergeBlock([account({ id: 1 }), account({ id: 2, name: 'バス代' })])).toBeNull()
  })

  it('区分が異なれば differentCategory を返す', () => {
    expect(findAccountMergeBlock([account({ id: 1 }), account({ id: 2, category: 'revenue' })])).toBe(
      'differentCategory',
    )
  })

  it('資産・負債で照合可否が異なれば differentReconcilability を返す', () => {
    const asset = { category: 'asset' as const }
    expect(
      findAccountMergeBlock([
        account({ id: 1, ...asset, isReconcilable: true }),
        account({ id: 2, ...asset, isReconcilable: false }),
      ]),
    ).toBe('differentReconcilability')
  })

  it('システム管理の科目を含めば、他の条件より先に systemManaged を返す', () => {
    expect(
      findAccountMergeBlock([account({ id: 1, isSystemManaged: true }), account({ id: 2, category: 'revenue' })]),
    ).toBe('systemManaged')
  })
})
