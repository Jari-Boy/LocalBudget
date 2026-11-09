/**
 * checkExpenseSplittability(割勘できるかと、できない理由を返す純粋関数、計画Issue #149)と
 * findDebitExpenseLines(付け替え対象の借方の費用行をすべて返す関数)のユニットテスト。
 * 割勘できない3条件(割勘で作られた仕訳・割勘済みの仕訳・借方に費用の行がない仕訳)を
 * 理由を区別して返すこと、費用の行が複数ある仕訳も割勘できることを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { checkExpenseSplittability, findDebitExpenseLines } from './checkExpenseSplittability'

function account(id: number, category: Account['category']): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const FOOD = 1
const DAILY = 2
const CASH = 3
const SALARY = 4
const ACCOUNTS = [account(FOOD, 'expense'), account(DAILY, 'expense'), account(CASH, 'asset'), account(SALARY, 'revenue')]

function line(accountId: number, side: 'debit' | 'credit', amount = 1000, id = 0): JournalLine {
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
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function entry(id: number, lines: JournalLine[], sourceType: JournalEntry['sourceType'] = 'manual'): JournalEntry {
  return {
    id,
    entryDate: '2026-07-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType,
    householdMemberId: 10,
    generatedFromRuleId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

describe('findDebitExpenseLines', () => {
  it('借方の費用行をすべて返す', () => {
    const e = entry(1, [line(FOOD, 'debit', 700, 1), line(DAILY, 'debit', 300, 2), line(CASH, 'credit', 1000, 3)])

    expect(findDebitExpenseLines(e, ACCOUNTS).map((l) => l.id)).toEqual([1, 2])
  })

  it('貸方の費用行(返金など)は含めない', () => {
    const e = entry(1, [line(CASH, 'debit', 1000, 1), line(FOOD, 'credit', 1000, 2)])

    expect(findDebitExpenseLines(e, ACCOUNTS)).toEqual([])
  })
})

describe('checkExpenseSplittability', () => {
  it('借方に費用の行が1件ある仕訳は割勘できる', () => {
    const e = entry(1, [line(FOOD, 'debit'), line(CASH, 'credit')])

    expect(checkExpenseSplittability(e, ACCOUNTS, [])).toEqual({ splittable: true })
  })

  it('借方に費用の行が複数ある仕訳も割勘できる', () => {
    const e = entry(1, [line(FOOD, 'debit', 700), line(DAILY, 'debit', 300), line(CASH, 'credit', 1000)])

    expect(checkExpenseSplittability(e, ACCOUNTS, [])).toEqual({ splittable: true })
  })

  it('割勘で作られた仕訳は理由 is_expense_split_entry で割勘できない', () => {
    const e = entry(1, [line(FOOD, 'debit'), line(CASH, 'credit')], 'expense_splitting')

    expect(checkExpenseSplittability(e, ACCOUNTS, [])).toEqual({
      splittable: false,
      reason: 'is_expense_split_entry',
    })
  })

  it('関連仕訳に割勘で作られた仕訳がある(割勘済み)仕訳は理由 already_split で割勘できない', () => {
    const e = entry(1, [line(FOOD, 'debit'), line(CASH, 'credit')])
    const split = entry(2, [line(FOOD, 'debit')], 'expense_splitting')

    expect(checkExpenseSplittability(e, ACCOUNTS, [split])).toEqual({ splittable: false, reason: 'already_split' })
  })

  it('関連仕訳が割勘で作られたものでなければ割勘済みとは判定しない(手入力の関連仕訳など)', () => {
    const e = entry(1, [line(FOOD, 'debit'), line(CASH, 'credit')])
    const manual = entry(2, [line(FOOD, 'debit'), line(CASH, 'credit')])

    expect(checkExpenseSplittability(e, ACCOUNTS, [manual])).toEqual({ splittable: true })
  })

  it('借方に費用の行がない仕訳(収益だけの仕訳)は理由 no_debit_expense_line で割勘できない', () => {
    const e = entry(1, [line(CASH, 'debit'), line(SALARY, 'credit')])

    expect(checkExpenseSplittability(e, ACCOUNTS, [])).toEqual({
      splittable: false,
      reason: 'no_debit_expense_line',
    })
  })

  it('費用の行が貸方だけの仕訳も理由 no_debit_expense_line で割勘できない', () => {
    const e = entry(1, [line(CASH, 'debit'), line(FOOD, 'credit')])

    expect(checkExpenseSplittability(e, ACCOUNTS, [])).toEqual({
      splittable: false,
      reason: 'no_debit_expense_line',
    })
  })

  it('複数の条件に当たる場合は 割勘で作られた仕訳 → 割勘済み → 借方に費用なし の順で理由を返す', () => {
    const splitWithoutExpense = entry(1, [line(CASH, 'debit'), line(SALARY, 'credit')], 'expense_splitting')
    const split = entry(2, [line(FOOD, 'debit')], 'expense_splitting')
    const alreadySplitWithoutExpense = entry(3, [line(CASH, 'debit'), line(SALARY, 'credit')])

    expect(checkExpenseSplittability(splitWithoutExpense, ACCOUNTS, [])).toMatchObject({
      reason: 'is_expense_split_entry',
    })
    expect(checkExpenseSplittability(alreadySplitWithoutExpense, ACCOUNTS, [split])).toMatchObject({
      reason: 'already_split',
    })
  })
})
