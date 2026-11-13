/**
 * isExpenseSplittingEntrySettled(割勘仕訳の精算状況判定)の純粋関数としてのユニットテスト。
 * settlement-batchドメインのcalculateSettlementBatchBalance(未精算残高の集計方式、
 * docs/domain/settlement.md、計画Issue #133)を、割勘仕訳が持ちうる立替金(資産)・立替金(負債)
 * 双方の科目行に適用し、いずれも残高0になって初めて「精算済み」とみなすことを検証する
 * (docs/domain/expense-splitting.md 1.3節、世帯メンバー間の割勘は資産側・負債側が別々の
 * タイミングで精算されうるため、片方のみの精算を「精算済み」と誤判定しないことが重要)。
 * journal_entry_linksによる明示的な消込リンクは廃止され、精算仕訳側の一時勘定行に
 * settlementBatchIdタグを付与するだけで集計に乗る設計になったため、判定にはDB全体の
 * 明細行(allLines)を渡す。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { isExpenseSplittingEntrySettled } from './isExpenseSplittingEntrySettled'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 2
const ADVANCE_LIABILITY_ACCOUNT_ID = 3
const BANK_ACCOUNT_ID = 4
const SETTLEMENT_BATCH_ID = 100

const ACCOUNTS: Account[] = [
  {
    id: EXPENSE_ACCOUNT_ID,
    category: 'expense',
    name: '食費',
    isReconcilable: null,
    hasExternalStatement: null,
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
    hasExternalStatement: false,
    isActive: true,
    isSystemManaged: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  {
    id: ADVANCE_LIABILITY_ACCOUNT_ID,
    category: 'liability',
    name: '立替金',
    isReconcilable: false,
    hasExternalStatement: false,
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
    hasExternalStatement: true,
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
    recurringDueDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

/**
 * buildSettlementJournalEntryInputが組み立てる、一時勘定行(settlementBatchIdタグ付き)を1本だけ
 * 持つ精算仕訳を模す。一時勘定行のsideは残高を減少させる向き(資産はcredit、負債はdebit)にする
 */
function buildSettlementEntry(
  id: number,
  settlementAccountId: number,
  settlementAccountCategory: 'asset' | 'liability',
  householdMemberId: number,
  amount: number,
): JournalEntry {
  const decreasingSide = settlementAccountCategory === 'asset' ? 'credit' : 'debit'
  return buildEntry(id, [
    buildLine({
      id: id * 10 + 1,
      journalEntryId: id,
      accountId: BANK_ACCOUNT_ID,
      side: decreasingSide === 'credit' ? 'debit' : 'credit',
      amount,
    }),
    buildLine({
      id: id * 10 + 2,
      journalEntryId: id,
      accountId: settlementAccountId,
      householdMemberId,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      side: decreasingSide,
      amount,
    }),
  ])
}

describe('isExpenseSplittingEntrySettled', () => {
  it('世帯外の相手との割勘(資産側のみ)で、資産側が全額精算済みの場合はtrueを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({
        id: 1,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 2, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'credit', amount: 500 }),
    ])
    const settlementEntry = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 'asset', 10, 500)
    const allLines = [...splitEntry.lines, ...settlementEntry.lines]

    expect(isExpenseSplittingEntrySettled(splitEntry, ACCOUNTS, allLines)).toBe(true)
  })

  it('世帯外の相手との割勘(資産側のみ)で、未精算の場合はfalseを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({
        id: 1,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 2, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'credit', amount: 500 }),
    ])

    expect(isExpenseSplittingEntrySettled(splitEntry, ACCOUNTS, splitEntry.lines)).toBe(false)
  })

  it('世帯メンバー間の割勘(資産側+負債側)で、両方とも全額精算済みの場合はtrueを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 500,
      }),
    ])
    const settlementEntryForAsset = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 'asset', 10, 500)
    const settlementEntryForLiability = buildSettlementEntry(3, ADVANCE_LIABILITY_ACCOUNT_ID, 'liability', 20, 500)
    const allLines = [...splitEntry.lines, ...settlementEntryForAsset.lines, ...settlementEntryForLiability.lines]

    expect(isExpenseSplittingEntrySettled(splitEntry, ACCOUNTS, allLines)).toBe(true)
  })

  it('世帯メンバー間の割勘で、資産側のみ精算済み・負債側が未精算の場合はfalseを返す(片方だけの精算を精算済みと誤判定しない)', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 500,
      }),
    ])
    const settlementEntryForAsset = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 'asset', 10, 500)
    const allLines = [...splitEntry.lines, ...settlementEntryForAsset.lines]

    expect(isExpenseSplittingEntrySettled(splitEntry, ACCOUNTS, allLines)).toBe(false)
  })

  it('世帯メンバー間の割勘で、両方とも未精算の場合はfalseを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 500,
      }),
    ])

    expect(isExpenseSplittingEntrySettled(splitEntry, ACCOUNTS, splitEntry.lines)).toBe(false)
  })
})
