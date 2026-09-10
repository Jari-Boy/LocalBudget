/**
 * resolveExpenseSplittingParticipant(割勘仕訳から分担者を特定する)の
 * 純粋関数としてのユニットテスト。docs/domain/expense-splitting.md 1.3節(世帯メンバー間、
 * 立替金負債行のhousehold_member_idが分担者)・1.4節(世帯外の相手、費用行のcounterparty_idが
 * 分担者)の2パターンを、buildHouseholdMemberExpenseSplittingJournalEntryInput・
 * buildCounterpartyExpenseSplittingJournalEntryInputが組み立てる行構成に沿って検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { resolveExpenseSplittingParticipant } from './resolveExpenseSplittingParticipant'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 2
const ADVANCE_LIABILITY_ACCOUNT_ID = 3

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

function buildEntry(lines: JournalLine[]): JournalEntry {
  return {
    id: 1,
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

describe('resolveExpenseSplittingParticipant', () => {
  it('世帯メンバー間の割勘仕訳(4行)の場合、立替金(負債)行のhouseholdMemberIdを分担者として返す', () => {
    const fromMemberId = 10
    const toMemberId = 20
    const splitEntry = buildEntry([
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: toMemberId, side: 'debit' }),
      buildLine({
        id: 2,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: fromMemberId,
        projectId: 100,
        side: 'debit',
      }),
      buildLine({ id: 3, accountId: EXPENSE_ACCOUNT_ID, householdMemberId: fromMemberId, side: 'credit' }),
      buildLine({
        id: 4,
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: toMemberId,
        projectId: 100,
        side: 'credit',
      }),
    ])

    const result = resolveExpenseSplittingParticipant(splitEntry, ACCOUNTS)

    expect(result).toEqual({ householdMemberId: toMemberId, counterpartyId: null })
  })

  it('世帯外の相手との割勘仕訳(2行)の場合、費用行のcounterpartyIdを分担者として返す', () => {
    const payerMemberId = 10
    const counterpartyId = 30
    const splitEntry = buildEntry([
      buildLine({
        id: 1,
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: payerMemberId,
        projectId: 100,
        side: 'debit',
      }),
      buildLine({
        id: 2,
        accountId: EXPENSE_ACCOUNT_ID,
        householdMemberId: payerMemberId,
        counterpartyId,
        side: 'credit',
      }),
    ])

    const result = resolveExpenseSplittingParticipant(splitEntry, ACCOUNTS)

    expect(result).toEqual({ householdMemberId: null, counterpartyId })
  })

  it('立替金(負債)行もcounterparty_idを持つ行も無い場合、undefinedを返す', () => {
    const splitEntry = buildEntry([
      buildLine({ id: 1, accountId: EXPENSE_ACCOUNT_ID, side: 'debit' }),
      buildLine({ id: 2, accountId: ADVANCE_ASSET_ACCOUNT_ID, projectId: 100, side: 'credit' }),
    ])

    const result = resolveExpenseSplittingParticipant(splitEntry, ACCOUNTS)

    expect(result).toBeUndefined()
  })
})
