/**
 * listAccountBalances(登録済み科目一覧+残高)の純粋関数としてのユニットテスト。
 * 計画Issue #70(科目一覧確認画面)向けに、区分・残高0による絞り込みを行わず、
 * 渡された全科目についてcalculateAccountBalanceの残高計算式を適用して一覧を返すことを検証する。
 * summarizeAccountsByCategoryとの違い(区分絞り込みなし・残高0科目も除外しない)を
 * 明示的にテストする。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { listAccountBalances } from './listAccountBalances'

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    category: 'asset',
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

function buildLine(accountId: number, side: 'debit' | 'credit', amount: number): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function buildEntry(lines: JournalLine[]): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines,
  }
}

describe('listAccountBalances', () => {
  it('科目ごとに残高を計算して一覧を返す(区分の絞り込みは行わない)', () => {
    const accounts: Account[] = [
      buildAccount({ id: 1, category: 'asset', name: '普通預金' }),
      buildAccount({ id: 2, category: 'liability', name: 'クレジットカード' }),
    ]
    const entries = [buildEntry([buildLine(1, 'debit', 5000), buildLine(2, 'credit', 3000)])]

    expect(listAccountBalances(entries, accounts)).toEqual([
      { accountId: 1, accountName: '普通預金', amount: 5000, householdMemberId: null },
      { accountId: 2, accountName: 'クレジットカード', amount: 3000, householdMemberId: null },
    ])
  })

  it('残高が0の科目も除外せず一覧に含める', () => {
    const accounts: Account[] = [buildAccount({ id: 1, name: '普通預金' })]
    const entries = [buildEntry([buildLine(1, 'debit', 1000), buildLine(1, 'credit', 1000)])]

    expect(listAccountBalances(entries, accounts)).toEqual([
      { accountId: 1, accountName: '普通預金', amount: 0, householdMemberId: null },
    ])
  })

  it('該当する仕訳明細が1件も無い科目も、残高0として一覧に含める', () => {
    const accounts: Account[] = [buildAccount({ id: 1, name: '新規口座' })]

    expect(listAccountBalances([], accounts)).toEqual([
      { accountId: 1, accountName: '新規口座', amount: 0, householdMemberId: null },
    ])
  })

  it('householdMemberIdをそのまま結果に含める', () => {
    const accounts: Account[] = [buildAccount({ id: 1, name: '個人口座', householdMemberId: 7 })]

    expect(listAccountBalances([], accounts)).toEqual([
      { accountId: 1, accountName: '個人口座', amount: 0, householdMemberId: 7 },
    ])
  })

  it('一覧の並び順はaccounts引数の順序と一致する', () => {
    const accounts: Account[] = [
      buildAccount({ id: 3, name: 'C' }),
      buildAccount({ id: 1, name: 'A' }),
      buildAccount({ id: 2, name: 'B' }),
    ]

    expect(listAccountBalances([], accounts).map((item) => item.accountId)).toEqual([3, 1, 2])
  })
})
