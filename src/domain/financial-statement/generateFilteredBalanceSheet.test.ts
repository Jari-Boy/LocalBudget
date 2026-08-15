/**
 * generateFilteredBalanceSheet(複数軸フィルタ付きBS生成)の純粋関数としての
 * ユニットテスト。FS画面(計画Issue #34)のプロジェクト別・世帯メンバー別・取引先別の
 * 複数選択絞り込み(docs/domain/financial-statements.md 2.2節)を適用したBSを生成する。
 * generateBalanceSheetの基準日フィルタリングに、filterJournalLinesByFinancialStatementFilter
 * による軸フィルタリングを組み合わせる構成で、フィルタ未指定時はgenerateBalanceSheetと
 * 同じ結果になること(恒等式「資産=負債+純資産+(収益-費用)」を含む)、軸フィルタ指定時に
 * 絞り込まれることを中心に検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { generateFilteredBalanceSheet } from './generateFilteredBalanceSheet'

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

function buildEntry(overrides: Partial<JournalEntry> & Pick<JournalEntry, 'lines'>): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 900,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'asset', name: '現金' }),
  buildAccount({ id: 2, category: 'equity', name: '元入金', isSystemManaged: true }),
  buildAccount({ id: 3, category: 'revenue', name: '給与' }),
  buildAccount({ id: 4, category: 'expense', name: '食費' }),
]

describe('generateFilteredBalanceSheet', () => {
  it('フィルタを指定しなければgenerateBalanceSheetと同じ結果になる(恒等式を満たす)', () => {
    const entries = [
      buildEntry({
        sourceType: 'initial_balance',
        lines: [line(1, { accountId: 1, amount: 100000 }), line(2, { accountId: 2, side: 'credit', amount: 100000 })],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-07-05',
        lines: [line(3, { accountId: 1, amount: 5000 }), line(4, { accountId: 3, side: 'credit', amount: 5000 })],
      }),
    ]

    const bs = generateFilteredBalanceSheet(entries, accounts, '2026-07-31', {})

    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity)
    expect(bs.totalAssets).toBe(105000)
    expect(bs.cumulativeNetIncome).toBe(5000)
  })

  it('projectIdsを指定すると、該当プロジェクトの明細のみで基準日までの残高を計算する', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-07-05',
        lines: [
          line(1, { accountId: 1, amount: 5000, projectId: 10 }),
          line(2, { accountId: 3, side: 'credit', amount: 5000, projectId: 10 }),
          line(3, { accountId: 1, amount: 9000, projectId: 20 }),
          line(4, { accountId: 3, side: 'credit', amount: 9000, projectId: 20 }),
        ],
      }),
    ]

    const bs = generateFilteredBalanceSheet(entries, accounts, '2026-07-31', { projectIds: [10] })

    expect(bs.totalAssets).toBe(5000)
    expect(bs.cumulativeNetIncome).toBe(5000)
  })

  it('基準日より後の明細は軸フィルタに関わらず集計対象外', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-08-01',
        lines: [
          line(1, { accountId: 1, amount: 5000, projectId: 10 }),
          line(2, { accountId: 3, side: 'credit', amount: 5000, projectId: 10 }),
        ],
      }),
    ]

    const bs = generateFilteredBalanceSheet(entries, accounts, '2026-07-31', { projectIds: [10] })

    expect(bs.totalAssets).toBe(0)
  })

  it('filter引数を省略した場合も絞り込みなしの結果になる', () => {
    const entries = [
      buildEntry({
        entryDate: '2026-07-05',
        lines: [line(1, { accountId: 1, amount: 3000 }), line(2, { accountId: 2, side: 'credit', amount: 3000 })],
      }),
    ]

    const bs = generateFilteredBalanceSheet(entries, accounts, '2026-07-31')

    expect(bs.totalAssets).toBe(3000)
  })
})
