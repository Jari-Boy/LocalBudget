/**
 * generateBalanceSheet(BS生成)の純粋関数としてのユニットテスト。
 * docs/domain/financial-statements.md 2.1節の
 * 「BS = ある基準日までの資産科目・負債科目・純資産科目の残高」というBS生成方式と、
 * 決算振替仕訳を行わない設計のため恒等式
 * 「資産 = 負債 + 純資産 + (収益 - 費用)」で純資産部を計算するルールを検証する。
 * 恒等式が任意の基準日で成立すること自体を最重要のテストケースとする。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { generateBalanceSheet } from './generateBalanceSheet'

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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'asset', name: '現金' }),
  buildAccount({ id: 2, category: 'equity', name: '元入金', isSystemManaged: true }),
  buildAccount({ id: 3, category: 'revenue', name: '給与' }),
  buildAccount({ id: 4, category: 'expense', name: '食費' }),
  buildAccount({ id: 5, category: 'liability', name: 'クレジットカード未払金' }),
]

function line(
  id: number,
  journalEntryId: number,
  accountId: number,
  side: 'debit' | 'credit',
  amount: number,
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const entries: JournalEntry[] = [
  buildEntry({
    id: 1,
    entryDate: '2026-01-01',
    sourceType: 'initial_balance',
    lines: [line(1, 1, 1, 'debit', 100000), line(2, 1, 2, 'credit', 100000)],
  }),
  buildEntry({
    id: 2,
    entryDate: '2026-07-05',
    lines: [line(3, 2, 1, 'debit', 300000), line(4, 2, 3, 'credit', 300000)],
  }),
  buildEntry({
    id: 3,
    entryDate: '2026-07-10',
    lines: [line(5, 3, 4, 'debit', 5000), line(6, 3, 1, 'credit', 5000)],
  }),
  buildEntry({
    id: 4,
    entryDate: '2026-07-12',
    lines: [line(7, 4, 4, 'debit', 2000), line(8, 4, 5, 'credit', 2000)],
  }),
  // 基準日より後の仕訳(集計対象外になることを確認するため)
  buildEntry({
    id: 5,
    entryDate: '2026-08-01',
    lines: [line(9, 5, 4, 'debit', 99999), line(10, 5, 1, 'credit', 99999)],
  }),
]

describe('generateBalanceSheet', () => {
  it('資産=負債+純資産+(収益-費用)の恒等式を満たす(決算振替仕訳なし設計)', () => {
    const bs = generateBalanceSheet(entries, accounts, '2026-07-31')

    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity)
  })

  it('資産科目の残高を基準日までの明細から計算する', () => {
    const bs = generateBalanceSheet(entries, accounts, '2026-07-31')

    // 100000 + 300000 - 5000 = 395000 (8/1の仕訳は基準日より後のため含めない)
    expect(bs.assets).toEqual([{ accountId: 1, accountName: '現金', amount: 395000 }])
    expect(bs.totalAssets).toBe(395000)
  })

  it('負債科目の残高を基準日までの明細から計算する', () => {
    const bs = generateBalanceSheet(entries, accounts, '2026-07-31')

    expect(bs.liabilities).toEqual([
      { accountId: 5, accountName: 'クレジットカード未払金', amount: 2000 },
    ])
    expect(bs.totalLiabilities).toBe(2000)
  })

  it('純資産部は「純資産科目の貸方残高+収益科目の貸方残高-費用科目の借方残高」で計算する', () => {
    const bs = generateBalanceSheet(entries, accounts, '2026-07-31')

    // 元入金100000 + 給与300000 - 食費7000(5000+2000) = 393000
    expect(bs.equity).toEqual([{ accountId: 2, accountName: '元入金', amount: 100000 }])
    expect(bs.cumulativeNetIncome).toBe(293000)
    expect(bs.totalEquity).toBe(393000)
  })

  it('収益科目・費用科目自体はBSの内訳(assets/liabilities/equity)には含めない', () => {
    const bs = generateBalanceSheet(entries, accounts, '2026-07-31')

    const allAccountIds = [...bs.assets, ...bs.liabilities, ...bs.equity].map((a) => a.accountId)
    expect(allAccountIds).not.toContain(3) // 給与(revenue)
    expect(allAccountIds).not.toContain(4) // 食費(expense)
  })

  it('基準日より後の仕訳は集計対象に含めない', () => {
    const bsBeforeLastEntry = generateBalanceSheet(entries, accounts, '2026-07-31')
    const bsIncludingLastEntry = generateBalanceSheet(entries, accounts, '2026-08-01')

    expect(bsBeforeLastEntry.totalAssets).toBe(395000)
    expect(bsIncludingLastEntry.totalAssets).toBe(295001)
  })

  it('仕訳が0件の場合はすべての内訳が空配列、合計・恒等式ともに0になる', () => {
    const bs = generateBalanceSheet([], accounts, '2026-07-31')

    expect(bs).toEqual({
      asOfDate: '2026-07-31',
      assets: [],
      liabilities: [],
      equity: [],
      cumulativeNetIncome: 0,
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
    })
  })
})
