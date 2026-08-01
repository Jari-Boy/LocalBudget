/**
 * generateProfitAndLoss(PL生成)の純粋関数としてのユニットテスト。
 * docs/domain/financial-statements.md 2.1節の
 * 「PL = 指定期間内の収益科目・費用科目に属する仕訳明細の合計」というPL生成方式を、
 * 期間境界(inclusive)・区分によるフィルタリング(資産等の除外)・科目別内訳の集計・
 * 明細0件の境界値を含め検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { generateProfitAndLoss } from './generateProfitAndLoss'

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

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'expense', name: '食費' }),
  buildAccount({ id: 2, category: 'revenue', name: '給与' }),
  buildAccount({ id: 3, category: 'asset', name: '現金' }),
]

describe('generateProfitAndLoss', () => {
  it('期間内の費用科目・収益科目の明細を科目別に集計する', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        entryDate: '2026-07-10',
        lines: [
          { id: 1, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 3000, createdAt: '2026-07-10T00:00:00.000Z' },
          { id: 2, journalEntryId: 1, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 3000, createdAt: '2026-07-10T00:00:00.000Z' },
        ],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-07-15',
        lines: [
          { id: 3, journalEntryId: 2, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 250000, createdAt: '2026-07-15T00:00:00.000Z' },
          { id: 4, journalEntryId: 2, accountId: 2, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 250000, createdAt: '2026-07-15T00:00:00.000Z' },
        ],
      }),
    ]

    const pl = generateProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31')

    expect(pl.expenses).toEqual([{ accountId: 1, accountName: '食費', amount: 3000 }])
    expect(pl.revenues).toEqual([{ accountId: 2, accountName: '給与', amount: 250000 }])
    expect(pl.totalExpense).toBe(3000)
    expect(pl.totalRevenue).toBe(250000)
    expect(pl.netIncome).toBe(247000)
  })

  it('資産・負債・純資産科目の明細はPLに含めない', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        entryDate: '2026-07-10',
        lines: [
          { id: 1, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 1000, createdAt: '2026-07-10T00:00:00.000Z' },
          { id: 2, journalEntryId: 1, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 1000, createdAt: '2026-07-10T00:00:00.000Z' },
        ],
      }),
    ]

    const pl = generateProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31')

    expect(pl.expenses).toEqual([{ accountId: 1, accountName: '食費', amount: 1000 }])
    expect(pl.revenues).toEqual([])
  })

  it('期間の開始日・終了日は境界を含む(inclusive)', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        entryDate: '2026-07-01',
        lines: [
          { id: 1, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 100, createdAt: '2026-07-01T00:00:00.000Z' },
          { id: 2, journalEntryId: 1, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 100, createdAt: '2026-07-01T00:00:00.000Z' },
        ],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-07-31',
        lines: [
          { id: 3, journalEntryId: 2, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 200, createdAt: '2026-07-31T00:00:00.000Z' },
          { id: 4, journalEntryId: 2, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 200, createdAt: '2026-07-31T00:00:00.000Z' },
        ],
      }),
    ]

    const pl = generateProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31')

    expect(pl.totalExpense).toBe(300)
  })

  it('期間外(前後)の明細は集計から除外する', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        entryDate: '2026-06-30',
        lines: [
          { id: 1, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 100, createdAt: '2026-06-30T00:00:00.000Z' },
          { id: 2, journalEntryId: 1, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 100, createdAt: '2026-06-30T00:00:00.000Z' },
        ],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-08-01',
        lines: [
          { id: 3, journalEntryId: 2, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 200, createdAt: '2026-08-01T00:00:00.000Z' },
          { id: 4, journalEntryId: 2, accountId: 3, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: 200, createdAt: '2026-08-01T00:00:00.000Z' },
        ],
      }),
    ]

    const pl = generateProfitAndLoss(entries, accounts, '2026-07-01', '2026-07-31')

    expect(pl.expenses).toEqual([])
    expect(pl.totalExpense).toBe(0)
  })

  it('該当明細が0件の場合はrevenues・expensesともに空配列、totalは0、netIncomeも0を返す', () => {
    const pl = generateProfitAndLoss([], accounts, '2026-07-01', '2026-07-31')

    expect(pl).toEqual({
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      revenues: [],
      expenses: [],
      totalRevenue: 0,
      totalExpense: 0,
      netIncome: 0,
    })
  })
})
