/**
 * isExpenseSplittingEntrySettled(割勘仕訳の精算状況判定)の純粋関数としての
 * ユニットテスト。settlementドメインのcalculateSettlementBalance(消込残高の計算、
 * docs/domain/settlement.md 1.6節)を、割勘仕訳が持ちうる立替金(資産)・立替金(負債)
 * 双方の科目行に適用し、いずれも残高0になって初めて「精算済み」とみなすことを検証する
 * (docs/domain/expense-splitting.md 1.3節、世帯メンバー間の割勘は資産側・負債側が別々の
 * タイミングで精算されうるため、片方のみの精算を「精算済み」と誤判定しないことが重要)。
 * settlesリンク自体はどの科目を対象にしたかの情報を持たないため、精算仕訳(from_entry側)の
 * 実体をentriesから解決し、その仕訳が実際に使っている立替金科目で対応付けることを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { isExpenseSplittingEntrySettled } from './isExpenseSplittingEntrySettled'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 2
const ADVANCE_LIABILITY_ACCOUNT_ID = 3
const BANK_ACCOUNT_ID = 4

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
    initialBalanceForAccountId: null,
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
    initialBalanceForAccountId: null,
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
    initialBalanceForAccountId: null,
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
    initialBalanceForAccountId: null,
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
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 10,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

/** buildSettlementJournalEntryInputが組み立てる、一時勘定行を1本だけ持つ精算仕訳を模す */
function buildSettlementEntry(id: number, settlementAccountId: number, amount: number): JournalEntry {
  return buildEntry(id, [
    buildLine({ id: 1, accountId: BANK_ACCOUNT_ID, side: 'debit', amount }),
    buildLine({ id: 2, accountId: settlementAccountId, side: 'credit', amount }),
  ])
}

function buildLink(fromEntryId: number, toEntryId: number, amount: number): JournalEntryLink {
  return {
    id: fromEntryId * 100 + toEntryId,
    fromEntryId,
    toEntryId,
    linkType: 'settles',
    amount,
    createdAt: '2026-07-03T00:00:00.000Z',
  }
}

describe('isExpenseSplittingEntrySettled', () => {
  it('世帯外の相手との割勘(資産側のみ)で、資産側が全額精算済みの場合はtrueを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: ADVANCE_ASSET_ACCOUNT_ID, projectId: 100, side: 'debit', amount: 500 }),
      buildLine({ id: 2, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'credit', amount: 500 }),
    ])
    const settlementEntry = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 500)
    const links = [buildLink(settlementEntry.id, splitEntry.id, 500)]

    expect(
      isExpenseSplittingEntrySettled(splitEntry, [splitEntry, settlementEntry], ACCOUNTS, links),
    ).toBe(true)
  })

  it('世帯外の相手との割勘(資産側のみ)で、未精算の場合はfalseを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: ADVANCE_ASSET_ACCOUNT_ID, projectId: 100, side: 'debit', amount: 500 }),
      buildLine({ id: 2, accountId: EXPENSE_ACCOUNT_ID, counterpartyId: 30, side: 'credit', amount: 500 }),
    ])

    expect(isExpenseSplittingEntrySettled(splitEntry, [splitEntry], ACCOUNTS, [])).toBe(false)
  })

  it('世帯メンバー間の割勘(資産側+負債側)で、両方とも全額精算済みの場合はtrueを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        projectId: 100,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        projectId: 100,
        side: 'credit',
        amount: 500,
      }),
    ])
    const settlementEntryForAsset = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 500)
    const settlementEntryForLiability = buildSettlementEntry(3, ADVANCE_LIABILITY_ACCOUNT_ID, 500)
    const links = [
      buildLink(settlementEntryForAsset.id, splitEntry.id, 500),
      buildLink(settlementEntryForLiability.id, splitEntry.id, 500),
    ]

    expect(
      isExpenseSplittingEntrySettled(
        splitEntry,
        [splitEntry, settlementEntryForAsset, settlementEntryForLiability],
        ACCOUNTS,
        links,
      ),
    ).toBe(true)
  })

  it('世帯メンバー間の割勘で、資産側のみ精算済み・負債側が未精算の場合はfalseを返す(片方だけの精算を精算済みと誤判定しない)', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        projectId: 100,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        projectId: 100,
        side: 'credit',
        amount: 500,
      }),
    ])
    const settlementEntryForAsset = buildSettlementEntry(2, ADVANCE_ASSET_ACCOUNT_ID, 500)
    const links = [buildLink(settlementEntryForAsset.id, splitEntry.id, 500)]

    expect(
      isExpenseSplittingEntrySettled(splitEntry, [splitEntry, settlementEntryForAsset], ACCOUNTS, links),
    ).toBe(false)
  })

  it('世帯メンバー間の割勘で、両方とも未精算の場合はfalseを返す', () => {
    const splitEntry = buildEntry(1, [
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 20, side: 'debit', amount: 500 }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: 10,
        projectId: 100,
        side: 'debit',
        amount: 500,
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: 10, side: 'credit', amount: 500 }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: 20,
        projectId: 100,
        side: 'credit',
        amount: 500,
      }),
    ])

    expect(isExpenseSplittingEntrySettled(splitEntry, [splitEntry], ACCOUNTS, [])).toBe(false)
  })
})
