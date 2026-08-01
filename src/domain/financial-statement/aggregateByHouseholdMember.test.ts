/**
 * aggregateByHouseholdMember(世帯メンバー別集計)の純粋関数としてのユニットテスト。
 * docs/domain/household-members.md 1.4節の
 * 「メンバー別合計 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * 実効メンバー = 対象household_member、期間で絞らず全期間が既定」という
 * メンバー軸の集計ルールを検証する。実効メンバーの解決
 * (COALESCE(journal_lines.household_member_id, accounts.household_member_id)、
 * 1.2節)を経由すること、全区分(資産等)にまたがる集計ができることを含む。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { aggregateByHouseholdMember } from './aggregateByHouseholdMember'

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

function buildEntry(overrides: Partial<JournalEntry> & Pick<JournalEntry, 'lines'>): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-07-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function line(
  id: number,
  journalEntryId: number,
  accountId: number,
  side: 'debit' | 'credit',
  amount: number,
  householdMemberId: number | null,
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId,
    accountId,
    projectId: null,
    householdMemberId,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

describe('aggregateByHouseholdMember', () => {
  it('明細側に直接household_member_idが指定されている場合はそれで絞り込む', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense', householdMemberId: null })]
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, lines: [line(1, 1, 1, 'debit', 3000, 10)] }),
      buildEntry({ id: 2, lines: [line(2, 2, 1, 'debit', 5000, 20)] }),
    ]

    expect(aggregateByHouseholdMember(entries, accounts, 10)).toBe(3000)
  })

  it('明細側がnullの場合は口座の既定値(accounts.householdMemberId)を継承して集計する', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense', householdMemberId: 10 })]
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, lines: [line(1, 1, 1, 'debit', 3000, null)] }),
    ]

    expect(aggregateByHouseholdMember(entries, accounts, 10)).toBe(3000)
  })

  it('全区分(資産・費用等)にまたがる明細を区分に応じて符号反転して合算する', () => {
    const accounts: Account[] = [
      buildAccount({ id: 1, category: 'asset', name: '現金' }),
      buildAccount({ id: 2, category: 'expense', name: '食費' }),
    ]
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [line(1, 1, 2, 'debit', 3000, 10), line(2, 1, 1, 'credit', 3000, 10)],
      }),
    ]

    // 食費(expense): debit-credit=3000, 現金(asset): debit-credit=-3000, 合計0
    expect(aggregateByHouseholdMember(entries, accounts, 10)).toBe(0)
  })

  it('期間を指定した場合はその期間内の仕訳のみを集計対象とする', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense' })]
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, entryDate: '2026-06-30', lines: [line(1, 1, 1, 'debit', 1000, 10)] }),
      buildEntry({ id: 2, entryDate: '2026-07-15', lines: [line(2, 2, 1, 'debit', 2000, 10)] }),
    ]

    expect(
      aggregateByHouseholdMember(entries, accounts, 10, { from: '2026-07-01', to: '2026-07-31' }),
    ).toBe(2000)
  })

  it('期間を指定しない場合は全期間を集計対象とする(household-members.md 1.4節)', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense' })]
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, entryDate: '2020-01-01', lines: [line(1, 1, 1, 'debit', 1000, 10)] }),
      buildEntry({ id: 2, entryDate: '2030-01-01', lines: [line(2, 2, 1, 'debit', 2000, 10)] }),
    ]

    expect(aggregateByHouseholdMember(entries, accounts, 10)).toBe(3000)
  })

  it('該当する明細が1件もない場合は0を返す', () => {
    const accounts: Account[] = [buildAccount({ id: 1, category: 'expense' })]
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, lines: [line(1, 1, 1, 'debit', 1000, 20)] }),
    ]

    expect(aggregateByHouseholdMember(entries, accounts, 10)).toBe(0)
  })
})
