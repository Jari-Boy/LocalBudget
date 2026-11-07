/**
 * isExpenseSplitEntry(ある仕訳が割勘仕訳自身かどうかの科目構成による判定)の
 * 純粋関数としてのユニットテスト。journal_entry_links(計画Issue #138で撤廃)に
 * 依存せず、「費用の付け替え行」と「立替金(is_system_managed)の発生行」の両方を
 * 持つかどうかだけで判定することを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 2
const BANK_ACCOUNT_ID = 3
const PAYABLE_ACCOUNT_ID = 4

const ACCOUNTS: Account[] = [
  {
    id: EXPENSE_ACCOUNT_ID,
    category: 'expense',
    name: '食費',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: ADVANCE_ASSET_ACCOUNT_ID,
    category: 'asset',
    name: '立替金',
    isReconcilable: false,
    isActive: true,
    isSystemManaged: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: BANK_ACCOUNT_ID,
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: PAYABLE_ACCOUNT_ID,
    category: 'liability',
    name: '未払金',
    isReconcilable: false,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
]

function buildLine(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 0,
    journalEntryId: 1,
    accountId: EXPENSE_ACCOUNT_ID,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'debit',
    amount: 500,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-07-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 10,
    generatedFromRuleId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

describe('isExpenseSplitEntry', () => {
  it('費用行+立替金行の両方を持つ割勘仕訳ではtrueを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitEntry(splitEntry, ACCOUNTS)).toBe(true)
  })

  it('立替金行を持たない元の支出仕訳ではfalseを返す', () => {
    const originalEntry = buildEntry(2, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: PAYABLE_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitEntry(originalEntry, ACCOUNTS)).toBe(false)
  })

  it('費用行を持たない精算仕訳(立替金⇔口座)ではfalseを返す', () => {
    const settlementEntry = buildEntry(3, [
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
      buildLine({ accountId: BANK_ACCOUNT_ID, side: 'debit' }),
    ])

    expect(isExpenseSplitEntry(settlementEntry, ACCOUNTS)).toBe(false)
  })
})
