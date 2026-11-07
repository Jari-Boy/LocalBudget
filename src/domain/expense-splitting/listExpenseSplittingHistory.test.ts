/**
 * listExpenseSplittingHistory(全仕訳からの割勘履歴一覧の構築)の純粋関数としての
 * ユニットテスト。traceExpenseSplittingHistory(関連仕訳グループ+科目構成による分類、
 * 計画Issue #138)を全仕訳候補に対して実行し、結果をsplitEntry(割勘仕訳)単位で
 * グルーピングし直すことで実現できることを検証する(docs/domain/expense-splitting.md
 * 1.5節「settlement_batch_idでバッチ全体の仕訳を横断的に一覧することもできる」を踏まえた
 * 横断一覧)。1件の割勘仕訳が複数の元仕訳を対象にする場合(計画Issue #40「複数の元仕訳を
 * まとめて一括割勘」)、同じ割勘仕訳が複数回検出されてしまう点をグルーピングで1件に統合
 * できることが本関数の主眼。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { listExpenseSplittingHistory } from './listExpenseSplittingHistory'

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

function buildEntry(id: number, lines: JournalLine[], entryDate = '2026-07-01'): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    generatedFromRuleId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

function buildOriginalEntry(id: number, entryDate = '2026-07-01'): JournalEntry {
  return buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, PAYABLE_ACCOUNT_ID, 'credit')], entryDate)
}

/** 割勘仕訳は source_type = 'expense_splitting' で保存される(計画Issue #149) */
function buildSplitEntry(id: number): JournalEntry {
  return {
    ...buildEntry(id, [buildLine(id, EXPENSE_ACCOUNT_ID, 'debit'), buildLine(id, ADVANCE_ACCOUNT_ID, 'credit')]),
    sourceType: 'expense_splitting',
  }
}

function buildSettlementEntry(id: number): JournalEntry {
  return buildEntry(id, [buildLine(id, ADVANCE_ACCOUNT_ID, 'debit'), buildLine(id, BANK_ACCOUNT_ID, 'credit')])
}

describe('listExpenseSplittingHistory', () => {
  it('割勘仕訳が1件も存在しない場合、空配列を返す', () => {
    const originalEntry = buildOriginalEntry(1)

    const result = listExpenseSplittingHistory([originalEntry], ACCOUNTS, new Map())

    expect(result).toEqual([])
  })

  it('単一の元仕訳から単一の割勘仕訳が作られた場合、1件の履歴エントリを返す', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1])],
    ])

    const result = listExpenseSplittingHistory([originalEntry, splitEntry], ACCOUNTS, relatedEntryIdsByEntryId)

    expect(result).toEqual([{ splitEntry, originalEntries: [originalEntry], settlementEntries: [] }])
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、同じ割勘仕訳を1件の履歴エントリに統合しoriginalEntriesへ全元仕訳を含める', () => {
    const smartphoneEntry = buildOriginalEntry(1)
    const tabletEntry = buildOriginalEntry(2)
    const splitEntry = buildSplitEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([3])],
      [2, new Set([3])],
      [3, new Set([1, 2])],
    ])

    const result = listExpenseSplittingHistory(
      [smartphoneEntry, tabletEntry, splitEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toHaveLength(1)
    expect(result[0].splitEntry).toEqual(splitEntry)
    expect(result[0].originalEntries).toEqual([smartphoneEntry, tabletEntry])
  })

  it('複数の元仕訳をまとめて1回で割勘した場合、originalEntriesはentries内の登場順ではなく取引日の昇順で並ぶ(Review Attempt 2指摘: findAll()の返り順=id順に依存しない)', () => {
    const laterEntry = buildOriginalEntry(1, '2026-07-10')
    const earlierEntry = buildOriginalEntry(2, '2026-07-05')
    const splitEntry = buildSplitEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([3])],
      [2, new Set([3])],
      [3, new Set([1, 2])],
    ])

    // entries配列内の登場順はlaterEntryが先だが、取引日はearlierEntryの方が早い
    const result = listExpenseSplittingHistory([laterEntry, earlierEntry, splitEntry], ACCOUNTS, relatedEntryIdsByEntryId)

    expect(result).toHaveLength(1)
    expect(result[0].originalEntries.map((entry) => entry.id)).toEqual([earlierEntry.id, laterEntry.id])
  })

  it('複数件の独立した割勘がある場合、それぞれ別の履歴エントリとして返す', () => {
    const originalEntryA = buildOriginalEntry(1)
    const splitEntryA = buildSplitEntry(2)
    const originalEntryB = buildOriginalEntry(3)
    const splitEntryB = buildSplitEntry(4)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1])],
      [3, new Set([4])],
      [4, new Set([3])],
    ])

    const result = listExpenseSplittingHistory(
      [originalEntryA, splitEntryA, originalEntryB, splitEntryB],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toHaveLength(2)
    expect(result.map((item) => item.splitEntry.id).sort()).toEqual([splitEntryA.id, splitEntryB.id])
  })

  it('精算済みの割勘仕訳は、対応する精算仕訳をsettlementEntriesに含める', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const settlementEntry = buildSettlementEntry(3)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1, 3])],
      [3, new Set([2])],
    ])

    const result = listExpenseSplittingHistory(
      [originalEntry, splitEntry, settlementEntry],
      ACCOUNTS,
      relatedEntryIdsByEntryId,
    )

    expect(result).toEqual([
      { splitEntry, originalEntries: [originalEntry], settlementEntries: [settlementEntry] },
    ])
  })

  it('割勘仕訳自身は元仕訳(originalEntries)として結果に登場しない', () => {
    const originalEntry = buildOriginalEntry(1)
    const splitEntry = buildSplitEntry(2)
    const relatedEntryIdsByEntryId = new Map([
      [1, new Set([2])],
      [2, new Set([1])],
    ])

    const result = listExpenseSplittingHistory([originalEntry, splitEntry], ACCOUNTS, relatedEntryIdsByEntryId)

    expect(result.some((item) => item.originalEntries.some((entry) => entry.id === splitEntry.id))).toBe(false)
  })
})
