/**
 * aggregateByCounterparty(取引先別集計)の純粋関数としてのユニットテスト。
 * docs/domain/counterparties.md 1.7節の
 * 「取引先別合計 = Σ(amount WHERE side=増加側) - Σ(amount WHERE side=減少側)、
 * 期間で絞らず全期間が既定」という取引先軸の集計ルールを、対象取引先のみへの絞り込み・
 * 期間指定あり/なし・複数区分(収益・費用)にまたがる合算・該当明細なしの境界値を含め検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { aggregateByCounterparty } from './aggregateByCounterparty'

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
    householdMemberId: 999,
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
  counterpartyId: number | null,
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId,
    side,
    amount,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'expense', name: '食費' }),
  buildAccount({ id: 2, category: 'revenue', name: '雑収入' }),
]

describe('aggregateByCounterparty', () => {
  it('指定した取引先の明細のみを抽出して合算する(他取引先は除外)', () => {
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, lines: [line(1, 1, 1, 'debit', 3000, 100)] }),
      buildEntry({ id: 2, lines: [line(2, 2, 1, 'debit', 5000, 200)] }),
    ]

    expect(aggregateByCounterparty(entries, accounts, 100)).toBe(3000)
  })

  it('複数区分(費用・収益)にまたがる明細も区分に応じて符号反転して合算する', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [line(1, 1, 1, 'debit', 3000, 100), line(2, 1, 2, 'credit', 500, 100)],
      }),
    ]

    // 食費(expense): debit-credit=3000, 雑収入(revenue): credit-debit=500, 合計3500
    expect(aggregateByCounterparty(entries, accounts, 100)).toBe(3500)
  })

  it('期間を指定した場合はその期間内の仕訳のみを集計対象とする', () => {
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, entryDate: '2026-06-30', lines: [line(1, 1, 1, 'debit', 1000, 100)] }),
      buildEntry({ id: 2, entryDate: '2026-07-15', lines: [line(2, 2, 1, 'debit', 2000, 100)] }),
      buildEntry({ id: 3, entryDate: '2026-08-01', lines: [line(3, 3, 1, 'debit', 4000, 100)] }),
    ]

    expect(
      aggregateByCounterparty(entries, accounts, 100, { from: '2026-07-01', to: '2026-07-31' }),
    ).toBe(2000)
  })

  it('期間を指定しない場合は全期間を集計対象とする(counterparties.md 1.7節)', () => {
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, entryDate: '2020-01-01', lines: [line(1, 1, 1, 'debit', 1000, 100)] }),
      buildEntry({ id: 2, entryDate: '2030-01-01', lines: [line(2, 2, 1, 'debit', 2000, 100)] }),
    ]

    expect(aggregateByCounterparty(entries, accounts, 100)).toBe(3000)
  })

  it('該当する明細が1件もない場合は0を返す', () => {
    const entries: JournalEntry[] = [buildEntry({ id: 1, lines: [line(1, 1, 1, 'debit', 1000, 200)] })]

    expect(aggregateByCounterparty(entries, accounts, 100)).toBe(0)
  })
})
