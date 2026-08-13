/**
 * summarizeProjectAccountBalances(プロジェクト別のPL/BS科目残高内訳)の
 * 純粋関数としてのユニットテスト。
 * docs/domain/projects.md 1.4節の「プロジェクト別科目残高」を、資産・負債・純資産・
 * 収益・費用の全区分について科目別の内訳(AccountAmount[])として返すことを検証する。
 * isSettlementBalanceZeroと同じ「project_id一致の明細を絞り込み→区分ごとに
 * summarizeAccountsByCategoryを適用」という組み立てのため、他プロジェクトの除外・
 * 残高0科目の除外(summarizeAccountsByCategoryの既存挙動)・該当明細なしの境界値を
 * 中心に検証する。DB非依存、外部依存なし(financial-statementドメインの
 * summarizeAccountsByCategoryをクロスドメインでimportする)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { summarizeProjectAccountBalances } from './summarizeProjectAccountBalances'

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
  projectId: number | null,
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId,
    accountId,
    projectId,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'asset', name: '立替金(資産)' }),
  buildAccount({ id: 2, category: 'liability', name: '立替金(負債)' }),
  buildAccount({ id: 3, category: 'equity', name: '元入金' }),
  buildAccount({ id: 4, category: 'revenue', name: '雑収入' }),
  buildAccount({ id: 5, category: 'expense', name: 'お土産代' }),
  buildAccount({ id: 6, category: 'expense', name: 'スーツケース(日用品)' }),
]

describe('summarizeProjectAccountBalances', () => {
  it('資産・負債・純資産・収益・費用の全区分について、指定したプロジェクトの科目別内訳を返す', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [
          line(1, 1, 1, 'debit', 3000, 100),
          line(2, 1, 2, 'credit', 2000, 100),
          line(3, 1, 3, 'credit', 1000, 100),
          line(4, 1, 4, 'credit', 500, 100),
          line(5, 1, 5, 'debit', 5000, 100),
        ],
      }),
    ]

    const result = summarizeProjectAccountBalances(entries, accounts, 100)

    expect(result.assets).toEqual([{ accountId: 1, accountName: '立替金(資産)', amount: 3000 }])
    expect(result.liabilities).toEqual([{ accountId: 2, accountName: '立替金(負債)', amount: 2000 }])
    expect(result.equity).toEqual([{ accountId: 3, accountName: '元入金', amount: 1000 }])
    expect(result.revenues).toEqual([{ accountId: 4, accountName: '雑収入', amount: 500 }])
    expect(result.expenses).toEqual([{ accountId: 5, accountName: 'お土産代', amount: 5000 }])
  })

  it('他のプロジェクトに紐づく明細は集計対象から除外する', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [line(1, 1, 5, 'debit', 5000, 100), line(2, 1, 6, 'debit', 3000, 200)],
      }),
    ]

    const result = summarizeProjectAccountBalances(entries, accounts, 100)

    expect(result.expenses).toEqual([{ accountId: 5, accountName: 'お土産代', amount: 5000 }])
  })

  it('残高が0になった科目は内訳から除外する(summarizeAccountsByCategoryの既存挙動を継承)', () => {
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [line(1, 1, 1, 'debit', 5000, 100), line(2, 1, 1, 'credit', 5000, 100)],
      }),
    ]

    const result = summarizeProjectAccountBalances(entries, accounts, 100)

    expect(result.assets).toEqual([])
  })

  it('同じ仕訳内でも行ごとに異なるプロジェクトを紐づけられる(複合仕訳の例)', () => {
    // docs/domain/projects.md 1.2節の例: 1回のカード決済でお土産(旅行用)とスーツケース(日用品)を同時に購入
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [
          line(1, 1, 5, 'debit', 5000, 100),
          line(2, 1, 6, 'debit', 3000, null),
          line(3, 1, 2, 'credit', 8000, null),
        ],
      }),
    ]

    const result = summarizeProjectAccountBalances(entries, accounts, 100)

    expect(result.expenses).toEqual([{ accountId: 5, accountName: 'お土産代', amount: 5000 }])
  })

  it('該当する明細が1件もない場合は全区分とも空配列を返す', () => {
    const entries: JournalEntry[] = [buildEntry({ id: 1, lines: [line(1, 1, 5, 'debit', 1000, 200)] })]

    const result = summarizeProjectAccountBalances(entries, accounts, 100)

    expect(result).toEqual({ assets: [], liabilities: [], equity: [], revenues: [], expenses: [] })
  })
})
