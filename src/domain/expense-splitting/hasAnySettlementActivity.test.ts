/**
 * hasAnySettlementActivity(割勘仕訳に対して何らかの精算操作が行われたかどうかの判定)の
 * 純粋関数としてのユニットテスト。isExpenseSplittingEntrySettled(全ての一時勘定行の残高が
 * ゼロになって初めて「精算済み」とみなす、履歴画面向けの厳密な判定)とは異なり、こちらは
 * 「少なくとも1件の精算操作が行われたか」を判定する(JournalEntryDetailScreenの取り消し
 * 導線向け、計画Issue #133。旧実装はjournal_entry_linksのsettlesリンクが1件でも存在すれば
 * 精算済み扱いとしていた挙動を、settlement_batch_idタグの集計方式で再現する)。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { hasAnySettlementActivity } from './hasAnySettlementActivity'

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
    id: ADVANCE_LIABILITY_ACCOUNT_ID,
    category: 'liability',
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

/** buildSettlementJournalEntryInputが組み立てる、一時勘定行を1本だけ持つ精算仕訳を模す */
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

describe('hasAnySettlementActivity', () => {
  it('精算操作が一度も行われていない場合はfalseを返す', () => {
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

    expect(hasAnySettlementActivity(splitEntry, ACCOUNTS, splitEntry.lines)).toBe(false)
  })

  it('資産側・負債側のどちらか一方だけが精算された場合でもtrueを返す(全額精算済みを要求するisExpenseSplittingEntrySettledとは異なる)', () => {
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
    // 負債側(分担者20)のみを精算し、資産側(立替者10)は未精算のまま
    const settlementEntryForLiability = buildSettlementEntry(2, ADVANCE_LIABILITY_ACCOUNT_ID, 'liability', 20, 500)
    const allLines = [...splitEntry.lines, ...settlementEntryForLiability.lines]

    expect(hasAnySettlementActivity(splitEntry, ACCOUNTS, allLines)).toBe(true)
  })

  it('一部の金額のみ精算された(端数が残る)場合でもtrueを返す', () => {
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
    const partialSettlementEntry = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 'asset', 10, 300)
    const allLines = [...splitEntry.lines, ...partialSettlementEntry.lines]

    expect(hasAnySettlementActivity(splitEntry, ACCOUNTS, allLines)).toBe(true)
  })

  it('同じ精算バッチに別の未精算の割勘仕訳が追加されただけでは、精算操作とみなさずfalseを返す(evaluatorレビュー指摘: 既存バッチへ複数の割勘を追記する正常な運用フローで誤ってtrueを返していた回帰)', () => {
    const splitEntry1 = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 500,
      }),
    ])
    // 同一バッチ・同一科目・同一世帯メンバーのタグを持つ、別の未精算の割勘仕訳(どちらも
    // 精算画面のいう「既存バッチへの追記」で発生しうる正常な状態)。精算仕訳ではないため、
    // どちらの一時勘定行も残高を増加させる向き(負債ならcredit)のまま
    const splitEntry2 = buildEntry(2, [
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'debit', amount: 300 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 300,
      }),
    ])
    const allLines = [...splitEntry1.lines, ...splitEntry2.lines]

    expect(hasAnySettlementActivity(splitEntry1, ACCOUNTS, allLines)).toBe(false)
  })

  it('立替金(一時勘定)の行を持たない仕訳はfalseを返す(割勘仕訳以外に誤って使われた場合の安全策)', () => {
    const entry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, side: 'debit', amount: 500 }),
      buildLine({ id: 2, accountId: BANK_ACCOUNT_ID, side: 'credit', amount: 500 }),
    ])

    expect(hasAnySettlementActivity(entry, ACCOUNTS, entry.lines)).toBe(false)
  })
})
