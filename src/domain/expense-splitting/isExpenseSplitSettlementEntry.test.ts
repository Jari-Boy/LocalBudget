/**
 * isExpenseSplitSettlementEntry(ある仕訳が割勘の精算仕訳かどうかの科目構成による判定)の
 * 純粋関数としてのユニットテスト。isExpenseSplitEntryと対になる判定で、journal_entry_links
 * (計画Issue #138で撤廃)に依存せず、立替金行を持ちつつ費用行を持たないことで精算仕訳を
 * 判定することを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplitSettlementEntry } from './isExpenseSplitSettlementEntry'

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
    householdMemberId: 1,
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

describe('isExpenseSplitSettlementEntry', () => {
  it('立替金行を持ち費用行を持たない精算仕訳ではtrueを返す', () => {
    const settlementEntry = buildEntry(1, [
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
      buildLine({ accountId: BANK_ACCOUNT_ID, side: 'debit' }),
    ])

    expect(isExpenseSplitSettlementEntry(settlementEntry, ACCOUNTS)).toBe(true)
  })

  it('費用行も持つ割勘仕訳ではfalseを返す', () => {
    const splitEntry = buildEntry(2, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitSettlementEntry(splitEntry, ACCOUNTS)).toBe(false)
  })

  it('立替金行を持たない仕訳ではfalseを返す', () => {
    const originalEntry = buildEntry(3, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: PAYABLE_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitSettlementEntry(originalEntry, ACCOUNTS)).toBe(false)
  })
})
