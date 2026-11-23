/**
 * planLineExpenseSplit(選んだ明細行と分担相手から、相手ごとの行ごとの負担額を決める純粋関数、計画Issue #271)の
 * ユニットテスト。submitExpenseSplit(書き込み)と割勘仕訳のプレビューが同じ計算を使うために切り出したもの。
 * 均等・割合は行ごとに按分して借方を正・貸方を負にすること、金額指定は純額に対する割合で配分すること、
 * 費用・収益でない行・純額0・合計超過のエラーを返すことを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { planLineExpenseSplit } from './planLineExpenseSplit'

const FOOD = 1
const INCOME = 2
const CASH = 3

function account(id: number, category: Account['category']): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const ACCOUNTS = [account(FOOD, 'expense'), account(INCOME, 'revenue'), account(CASH, 'asset')]

function line(id: number, accountId: number, side: 'debit' | 'credit', amount: number): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
  }
}

const ENTRY = {
  id: 1,
  entryDate: '2026-11-01',
  memo: null,
  comment: null,
  currency: 'JPY',
  sourceType: 'manual',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [],
} satisfies JournalEntry

const food = { entry: ENTRY, line: line(10, FOOD, 'debit', 2000) }
const income = { entry: ENTRY, line: line(11, INCOME, 'credit', 400) }
const cash = { entry: ENTRY, line: line(12, CASH, 'credit', 1600) }

const row = (ratio: string, amount = '') => ({
  key: 1,
  kind: 'householdMember' as const,
  targetId: 2,
  ratioInput: ratio,
  amountInput: amount,
})

describe('planLineExpenseSplit', () => {
  it('割合の按分は行ごとに計算し、借方の行は正・貸方の行は負の負担額にする', () => {
    const plan = planLineExpenseSplit({
      selectedLines: [food, income],
      accounts: ACCOUNTS,
      participants: [row('50')],
      allocationMode: 'ratio',
    })
    expect(plan).toEqual({ ok: true, recipients: [{ row: row('50'), signedShares: [1000, -200] }] })
  })

  it('金額指定は、入力した金額を純額に対する割合で行へ配分する', () => {
    // 純額 2000-400 = 1600。相手が800なら半分
    const plan = planLineExpenseSplit({
      selectedLines: [food, income],
      accounts: ACCOUNTS,
      participants: [row('', '800')],
      allocationMode: 'amount',
    })
    expect(plan).toMatchObject({ ok: true, recipients: [{ signedShares: [1000, -200] }] })
  })

  it('負担額がすべて0の相手は含めず、全員が0ならnoRecipientを返す', () => {
    expect(
      planLineExpenseSplit({ selectedLines: [food], accounts: ACCOUNTS, participants: [row('0')], allocationMode: 'ratio' }),
    ).toEqual({ ok: false, error: 'noRecipient' })
  })

  it('費用・収益でない行が混ざるとexpenseAccountNotFoundを返す', () => {
    expect(
      planLineExpenseSplit({ selectedLines: [food, cash], accounts: ACCOUNTS, participants: [row('50')], allocationMode: 'ratio' }),
    ).toEqual({ ok: false, error: 'expenseAccountNotFound' })
  })

  it('金額指定で純額が0ならamountNetZero、合計が純額を超えるならamountExceedsTotalを返す', () => {
    const zero = { entry: ENTRY, line: line(13, FOOD, 'debit', 400) }
    expect(
      planLineExpenseSplit({
        selectedLines: [zero, income],
        accounts: ACCOUNTS,
        participants: [row('', '100')],
        allocationMode: 'amount',
      }),
    ).toEqual({ ok: false, error: 'amountNetZero' })
    expect(
      planLineExpenseSplit({
        selectedLines: [food],
        accounts: ACCOUNTS,
        participants: [row('', '3000')],
        allocationMode: 'amount',
      }),
    ).toEqual({ ok: false, error: 'amountExceedsTotal' })
  })
})
