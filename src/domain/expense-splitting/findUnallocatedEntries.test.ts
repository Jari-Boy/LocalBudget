/**
 * findUnallocatedEntries(割勘対象候補の絞り込み)の純粋関数としてのユニットテスト。
 * journal_entry_links(計画Issue #132)のallocatesリンクによる絞り込みは計画Issue #138で
 * 関連仕訳グループ+科目構成による分類(isExpenseSplitEntry)に置き換わった。既に割勘仕訳と
 * 同一グループに属する元仕訳(=割勘済み)、および仕訳自身が割勘仕訳であるもの(「割勘の割勘」
 * を防ぐ、人間レビューでの指摘)を候補から除外することを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { findUnallocatedEntries } from './findUnallocatedEntries'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ACCOUNT_ID = 2
const PAYABLE_ACCOUNT_ID = 3

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
    sortOrder: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

const ACCOUNTS: Account[] = [
  account({ id: EXPENSE_ACCOUNT_ID, category: 'expense', name: '食費' }),
  account({ id: ADVANCE_ACCOUNT_ID, category: 'asset', name: '立替金', isSystemManaged: true, isReconcilable: false }),
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
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function buildEntry(id: number, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-06-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lines,
  }
}

function buildOriginalEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, PAYABLE_ACCOUNT_ID, 'credit')])
}

function buildSplitEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, ADVANCE_ACCOUNT_ID, 'credit')])
}

describe('findUnallocatedEntries', () => {
  it('関連仕訳グループに属さない仕訳は未割勘として抽出する', () => {
    const entry = buildOriginalEntry(1)

    const result = findUnallocatedEntries([entry], ACCOUNTS, new Map())

    expect(result).toEqual([entry])
  })

  it('既に割勘仕訳と同一グループに属する元仕訳(=割勘済み)は抽出しない', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1])],
    ])

    const result = findUnallocatedEntries([originalEntry, splitEntry], ACCOUNTS, relatedEntryIdsByEntryId)

    expect(result).toEqual([])
  })

  it('複数の仕訳から未割勘のものだけを抽出する(26/6分は除外、26/7分は候補として残る)', () => {
    const alreadySplitJuneEntry = buildOriginalEntry(1)
    const candidateJulyEntry = buildOriginalEntry(2)
    const splitEntry = buildSplitEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([3])],
      [3, new Set([1])],
    ])

    const result = findUnallocatedEntries(
      [alreadySplitJuneEntry, candidateJulyEntry, splitEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([candidateJulyEntry])
  })

  it('仕訳自身が割勘仕訳である場合は候補から除外する(割勘の割勘を防ぐ)', () => {
    const splitEntry = buildSplitEntry(2)

    const result = findUnallocatedEntries([splitEntry], ACCOUNTS, new Map())

    expect(result).toEqual([])
  })

  it('割勘仕訳が複数の元仕訳と同一グループに属する場合、いずれの元仕訳も候補から除外する', () => {
    const originalEntryA = buildOriginalEntry(1)
    const originalEntryB = buildOriginalEntry(2)
    const splitEntry = buildSplitEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([3])],
      [2, new Set([3])],
      [3, new Set([1, 2])],
    ])

    const result = findUnallocatedEntries(
      [originalEntryA, originalEntryB, splitEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([])
  })
})
