/**
 * generateFilteredProfitAndLoss(複数軸フィルタ付きPL生成)の純粋関数としての
 * ユニットテスト。FS画面(計画Issue #34)のプロジェクト別・世帯メンバー別・取引先別の
 * 複数選択絞り込み(docs/domain/financial-statements.md 2.2節)を適用したPLを生成する。
 * generateProfitAndLossの期間フィルタリングに、filterJournalLinesByFinancialStatementFilter
 * による軸フィルタリングを組み合わせる構成で、フィルタ未指定時はgenerateProfitAndLossと
 * 同じ結果になること、軸フィルタ指定時に絞り込まれることを中心に検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { generateFilteredProfitAndLoss } from './generateFilteredProfitAndLoss'

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
    householdMemberId: 900,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function line(
  id: number,
  overrides: Partial<JournalEntry['lines'][number]> = {},
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId: 1,
    accountId: 1,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side: 'debit',
    amount: 1000,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'expense', name: '食費' }),
  buildAccount({ id: 2, category: 'asset', name: '現金' }),
]

describe('generateFilteredProfitAndLoss', () => {
  it('フィルタを指定しなければgenerateProfitAndLossと同じ結果になる(期間内の全明細を集計)', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-07-10',
        lines: [line(1, { accountId: 1, amount: 3000 }), line(2, { accountId: 2, side: 'credit', amount: 3000 })],
      }),
    ]

    const pl = generateFilteredProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31', {})

    expect(pl.expenses).toEqual([{ accountId: 1, accountName: '食費', amount: 3000 }])
    expect(pl.totalExpense).toBe(3000)
  })

  it('projectIdsを指定すると、該当プロジェクトの明細のみで集計する', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-07-10',
        lines: [
          line(1, { accountId: 1, amount: 3000, projectId: 10 }),
          line(2, { accountId: 1, amount: 5000, projectId: 20 }),
          line(3, { accountId: 2, side: 'credit', amount: 8000 }),
        ],
      }),
    ]

    const pl = generateFilteredProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31', {
      projectIds: [10],
    })

    expect(pl.expenses).toEqual([{ accountId: 1, accountName: '食費', amount: 3000 }])
    expect(pl.totalExpense).toBe(3000)
  })

  it('期間外の明細は軸フィルタに関わらず集計対象外', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-06-30',
        lines: [
          line(1, { accountId: 1, amount: 3000, projectId: 10 }),
          line(2, { accountId: 2, side: 'credit', amount: 3000 }),
        ],
      }),
    ]

    const pl = generateFilteredProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31', {
      projectIds: [10],
    })

    expect(pl.totalExpense).toBe(0)
  })

  it('filter引数を省略した場合も絞り込みなしの結果になる', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-07-10',
        lines: [line(1, { accountId: 1, amount: 1000 }), line(2, { accountId: 2, side: 'credit', amount: 1000 })],
      }),
    ]

    const pl = generateFilteredProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31')

    expect(pl.totalExpense).toBe(1000)
  })
})
