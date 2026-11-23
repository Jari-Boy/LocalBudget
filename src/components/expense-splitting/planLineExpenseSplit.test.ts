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

  it('相手が一部の行の立替者でもよい。その相手には、自分が立て替えた行の分は割り当てない(自分との割勘にしない)', () => {
    const other = { entry: { ...ENTRY, id: 2, householdMemberId: 2 }, line: line(14, FOOD, 'debit', 1000) }
    // 食費2000は立替者1、食費1000は立替者2。相手が2なら、立替者2の行は対象外で、立替者1の行だけを割る
    const plan = planLineExpenseSplit({
      selectedLines: [food, other],
      accounts: ACCOUNTS,
      participants: [row('50')],
      allocationMode: 'ratio',
    })
    expect(plan).toEqual({ ok: true, recipients: [{ row: row('50'), signedShares: [1000, 0] }] })
  })

  it('金額指定でも、相手が立て替えた行を除いた行の純額に対して配分する', () => {
    const other = { entry: { ...ENTRY, id: 2, householdMemberId: 2 }, line: line(14, FOOD, 'debit', 1000) }
    const plan = planLineExpenseSplit({
      selectedLines: [food, other],
      accounts: ACCOUNTS,
      participants: [row('', '600')],
      allocationMode: 'amount',
    })
    // 相手2が立て替えていない行は食費2000だけ。600をその行へ配分する
    expect(plan).toEqual({ ok: true, recipients: [{ row: row('', '600'), signedShares: [600, 0] }] })
    expect(
      planLineExpenseSplit({ selectedLines: [food, other], accounts: ACCOUNTS, participants: [row('', '2500')], allocationMode: 'amount' }),
    ).toEqual({ ok: false, error: 'amountExceedsTotal' })
  })

  it('選んだ行がすべて相手の立替なら、割る行がなくnoRecipientを返す', () => {
    const mine = { entry: { ...ENTRY, id: 2, householdMemberId: 2 }, line: line(14, FOOD, 'debit', 1000) }
    expect(
      planLineExpenseSplit({ selectedLines: [mine], accounts: ACCOUNTS, participants: [row('50')], allocationMode: 'ratio' }),
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
