/**
 * traceExpenseSplittingHistory(元仕訳→割勘仕訳→精算仕訳のトラバーサル)の
 * 純粋関数としてのユニットテスト。journal_entry_links(計画Issue #132)のallocates/settles
 * リンクによる辿り方は計画Issue #138で廃止され、関連仕訳グループ(relatedEntryIdsByEntryId)+
 * 科目構成による分類(isExpenseSplitEntry/isExpenseSplitSettlementEntry)に置き換わった
 * ことを、精算前・精算後・複数の精算(分割消込)・複数元仕訳の一括割勘を含めて検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { traceExpenseSplittingHistory } from './traceExpenseSplittingHistory'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ACCOUNT_ID = 2
const BANK_ACCOUNT_ID = 3
const PAYABLE_ACCOUNT_ID = 4

function account(overrides: Partial<Account>): Account {
  return {
    id: 0,
    category: 'expense',
    name: '',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const ACCOUNTS: Account[] = [
  account({ id: EXPENSE_ACCOUNT_ID, category: 'expense', name: '食費' }),
  account({ id: ADVANCE_ACCOUNT_ID, category: 'asset', name: '立替金', isSystemManaged: true, isReconcilable: false }),
  account({ id: BANK_ACCOUNT_ID, category: 'asset', name: '普通預金', isReconcilable: true }),
  account({ id: PAYABLE_ACCOUNT_ID, category: 'liability', name: '未払金', isReconcilable: false }),
]

function buildLine(entryId: number, accountId: number, side: JournalLine['side']): JournalLine {
  return {
    id: entryId * 10 + accountId,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount: 500,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function buildOriginalEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, PAYABLE_ACCOUNT_ID, 'credit')])
}

function buildSplitEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, ADVANCE_ACCOUNT_ID, 'credit')])
}

function buildSettlementEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, ADVANCE_ACCOUNT_ID, 'debit'), buildLine(id, BANK_ACCOUNT_ID, 'credit')])
}

function buildEntry(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-07-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

describe('traceExpenseSplittingHistory', () => {
  it('精算前(割勘仕訳のみ)の場合、割勘仕訳を1件・精算仕訳を0件で辿る', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1])],
    ])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [] }])
  })

  it('精算後(割勘仕訳+精算仕訳)の場合、元仕訳→割勘仕訳→精算仕訳の一連の流れを辿る', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const settlementEntry = buildSettlementEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1, 3])],
      [3, new Set([2])],
    ])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry, settlementEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [settlementEntry] }])
  })

  it('複数の精算(分割消込)がある場合、すべての精算仕訳を返す', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const settlementEntry1 = buildSettlementEntry(3)
    const settlementEntry2 = buildSettlementEntry(4)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1, 3, 4])],
      [3, new Set([2])],
      [4, new Set([2])],
    ])

    const result = traceExpenseSplittingHistory(
      originalEntry,
      [originalEntry, splitEntry, settlementEntry1, settlementEntry2],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [settlementEntry1, settlementEntry2] }])
  })

  it('関連仕訳グループに1件も属さない元仕訳は空配列を返す', () => {
    const originalEntry = buildOriginalEntry(1)

    const result = traceExpenseSplittingHistory(originalEntry, [originalEntry], ACCOUNTS, new Map())

    expect(result).toEqual([])
  })

  it('1回の割勘バッチが複数の元仕訳をまとめて対象にする場合、対応する割勘仕訳だけを辿る', () => {
    const smartphoneEntry = buildOriginalEntry(1)
    const tabletEntry = buildOriginalEntry(2)
    const splitEntry = buildSplitEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([3])],
      [2, new Set([3])],
      [3, new Set([1, 2])],
    ])

    const result = traceExpenseSplittingHistory(
      smartphoneEntry,
      [smartphoneEntry, tabletEntry, splitEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([{ splitEntry, settlementEntries: [] }])
  })
})
