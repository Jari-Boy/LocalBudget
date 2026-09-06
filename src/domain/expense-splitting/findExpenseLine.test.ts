/**
 * findExpenseLine(割勘対象の仕訳から費用科目の行を特定する)の純粋関数としての
 * ユニットテスト。費用科目の行がちょうど1件の場合のみその行を返し、0件(給与/普通預金の
 * ような収益・資産のみの仕訳)・2件以上(どの行を付け替え対象にすべきか一意に定まらない)
 * の場合はundefinedを返すことを検証する(計画Issue #40、人間レビューでの指摘対応)。
 * 費用科目以外の行(収益・資産等)が混在していても、費用科目の行がちょうど1件であれば
 * 問題なく特定できることも確認する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account, AccountCategory } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { findExpenseLine } from './findExpenseLine'

function buildAccount(id: number, category: AccountCategory): Account {
  return {
    id,
    category,
    name: `account-${id}`,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

function buildLine(accountId: number, side: JournalLine['side'], amount: number): JournalLine {
  return {
    id: accountId * 10,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-06-01T00:00:00.000Z',
  }
}

function buildEntry(lines: JournalLine[]): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-06-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lines,
  }
}

describe('findExpenseLine', () => {
  it('費用科目の行がちょうど1件の場合、その行を返す', () => {
    const expenseAccount = buildAccount(1, 'expense')
    const cashAccount = buildAccount(2, 'asset')
    const entry = buildEntry([buildLine(1, 'debit', 1000), buildLine(2, 'credit', 1000)])

    const result = findExpenseLine(entry, [expenseAccount, cashAccount])

    expect(result).toMatchObject({ accountId: 1, amount: 1000 })
  })

  it('費用科目の行が1件も無い場合(給与/普通預金のような収益・資産のみの仕訳)、undefinedを返す', () => {
    const bankAccount = buildAccount(1, 'asset')
    const salaryAccount = buildAccount(2, 'revenue')
    const entry = buildEntry([buildLine(1, 'debit', 250000), buildLine(2, 'credit', 250000)])

    expect(findExpenseLine(entry, [bankAccount, salaryAccount])).toBeUndefined()
  })

  it('費用科目の行が2件以上ある場合、どの行を付け替え対象にすべきか一意に定まらないためundefinedを返す', () => {
    const foodExpense = buildAccount(1, 'expense')
    const suppliesExpense = buildAccount(2, 'expense')
    const cashAccount = buildAccount(3, 'asset')
    const entry = buildEntry([
      buildLine(1, 'debit', 300),
      buildLine(2, 'debit', 200),
      buildLine(3, 'credit', 500),
    ])

    expect(findExpenseLine(entry, [foodExpense, suppliesExpense, cashAccount])).toBeUndefined()
  })

  it('費用科目の行が1件で、収益科目の行も同時に存在する場合でも、その費用科目の行を返す', () => {
    const expenseAccount = buildAccount(1, 'expense')
    const revenueAccount = buildAccount(2, 'revenue')
    const cashAccount = buildAccount(3, 'asset')
    const entry = buildEntry([
      buildLine(1, 'debit', 500),
      buildLine(2, 'credit', 100),
      buildLine(3, 'credit', 400),
    ])

    const result = findExpenseLine(entry, [expenseAccount, revenueAccount, cashAccount])

    expect(result).toMatchObject({ accountId: 1, amount: 500 })
  })
})
