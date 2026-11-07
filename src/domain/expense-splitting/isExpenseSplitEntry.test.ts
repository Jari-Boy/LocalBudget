/**
 * isExpenseSplitEntry(ある仕訳が割勘仕訳自身かどうかの判定)の純粋関数としてのユニットテスト。
 * 計画Issue #149で、科目構成(費用行+立替金行)による判定から source_type = 'expense_splitting'
 * による判定へ切り替えた。手入力で同じ科目構成にした仕訳は割勘と判定されないことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 2
const BANK_ACCOUNT_ID = 3
const PAYABLE_ACCOUNT_ID = 4

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
  it('source_typeがexpense_splittingの仕訳ではtrueを返す', () => {
    const splitEntry = {
      ...buildEntry(1, [
        buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
        buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
      ]),
      sourceType: 'expense_splitting' as const,
    }

    expect(isExpenseSplitEntry(splitEntry)).toBe(true)
  })

  it('手入力で割勘と同じ科目構成(費用行+立替金行)にした仕訳はfalseを返す', () => {
    const manualEntry = buildEntry(2, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitEntry(manualEntry)).toBe(false)
  })

  it('立替金行を持たない元の支出仕訳ではfalseを返す', () => {
    const originalEntry = buildEntry(3, [
      buildLine({ accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ accountId: PAYABLE_ACCOUNT_ID, side: 'credit' }),
    ])

    expect(isExpenseSplitEntry(originalEntry)).toBe(false)
  })

  it('費用行を持たない精算仕訳(立替金⇔口座)ではfalseを返す', () => {
    const settlementEntry = buildEntry(4, [
      buildLine({ accountId: ADVANCE_ASSET_ACCOUNT_ID, side: 'credit' }),
      buildLine({ accountId: BANK_ACCOUNT_ID, side: 'debit' }),
    ])

    expect(isExpenseSplitEntry(settlementEntry)).toBe(false)
  })
})
