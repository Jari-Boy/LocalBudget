/**
 * listSplittableLineEntries(割勘タブの候補を明細行単位で返す純粋関数、計画Issue #271)と
 * signedLineAmount(借方を+・貸方を−にした行の金額)のユニットテスト。
 * 費用・収益の行(借方・貸方とも)が選べて、それ以外の行は選べない行として残ること、
 * 割勘済みの行(割勘対象行の記録に載っている行)と割勘で作られた仕訳は出ないこと、
 * 行の記録を持たない従来の割勘仕訳に繋がる仕訳は全体を出さないこと、選べる行が残らない仕訳は出ないことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { listSplittableLineEntries, signedLineAmount } from './listSplittableLineEntries'

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
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const FOOD = 1
const DAILY = 2
const CASH = 3
const INCOME = 4
const ACCOUNTS = [account(FOOD, 'expense'), account(DAILY, 'expense'), account(CASH, 'asset'), account(INCOME, 'revenue')]

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
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function entry(id: number, lines: JournalLine[], sourceType: JournalEntry['sourceType'] = 'manual'): JournalEntry {
  return {
    id,
    entryDate: '2026-10-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType,
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines,
  }
}

const NO_RELATED = new Map<number, ReadonlySet<number>>()

describe('signedLineAmount', () => {
  it('借方は正、貸方は負の金額にする', () => {
    expect(signedLineAmount(line(1, FOOD, 'debit', 500))).toBe(500)
    expect(signedLineAmount(line(2, FOOD, 'credit', 500))).toBe(-500)
  })
})

describe('listSplittableLineEntries', () => {
  it('費用・収益の行は借方・貸方とも選べて、それ以外の行は選べない行として残る', () => {
    const e = entry(1, [
      line(1, FOOD, 'debit', 800),
      line(2, INCOME, 'credit', 300),
      line(3, CASH, 'credit', 500),
    ])
    const [item] = listSplittableLineEntries([e], ACCOUNTS, NO_RELATED, [])
    expect(item.lines.map((l) => [l.line.id, l.selectable])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ])
  })

  it('選べない行には理由を付ける(費用・収益の行ではない)', () => {
    const e = entry(1, [line(1, FOOD, 'debit', 800), line(2, CASH, 'credit', 800)])
    const [item] = listSplittableLineEntries([e], ACCOUNTS, NO_RELATED, [])
    expect(item.lines.find((l) => l.line.id === 2)?.reason).toBe('not_profit_loss_account')
    expect(item.lines.find((l) => l.line.id === 1)?.reason).toBeNull()
  })

  it('割勘済みの行は表示せず、同じ仕訳の別の行は残す', () => {
    const e = entry(1, [line(1, FOOD, 'debit', 800), line(2, DAILY, 'debit', 200), line(3, CASH, 'credit', 1000)])
    const split = entry(9, [], 'expense_splitting')
    const [item] = listSplittableLineEntries([e, split], ACCOUNTS, NO_RELATED, [{ splitEntryId: 9, sourceLineId: 1 }])
    expect(item.lines.map((l) => l.line.id)).toEqual([2, 3])
  })

  it('選べる行がすべて割勘済みの仕訳は出さない', () => {
    const e = entry(1, [line(1, FOOD, 'debit', 800), line(2, CASH, 'credit', 800)])
    const split = entry(9, [], 'expense_splitting')
    expect(listSplittableLineEntries([e, split], ACCOUNTS, NO_RELATED, [{ splitEntryId: 9, sourceLineId: 1 }])).toEqual([])
  })

  it('費用・収益の行がない仕訳は出さない', () => {
    const e = entry(1, [line(1, CASH, 'debit', 800), line(2, CASH, 'credit', 800)])
    expect(listSplittableLineEntries([e], ACCOUNTS, NO_RELATED, [])).toEqual([])
  })

  it('割勘で作られた仕訳そのものは出さない', () => {
    const split = entry(9, [line(1, FOOD, 'debit', 400), line(2, CASH, 'credit', 400)], 'expense_splitting')
    expect(listSplittableLineEntries([split], ACCOUNTS, NO_RELATED, [])).toEqual([])
  })

  it('割勘対象行の記録を持たない従来の割勘仕訳に繋がる仕訳は、全体を出さない', () => {
    const original = entry(1, [line(1, FOOD, 'debit', 800), line(2, CASH, 'credit', 800)])
    const legacySplit = entry(9, [line(3, FOOD, 'debit', 400)], 'expense_splitting')
    const related = new Map<number, ReadonlySet<number>>([[1, new Set([9])]])
    expect(listSplittableLineEntries([original, legacySplit], ACCOUNTS, related, [])).toEqual([])
  })

  it('記録を持つ割勘仕訳に繋がっていても、割勘済みでない行があれば出す', () => {
    const original = entry(1, [line(1, FOOD, 'debit', 800), line(2, DAILY, 'debit', 200), line(3, CASH, 'credit', 1000)])
    const split = entry(9, [line(4, FOOD, 'debit', 400)], 'expense_splitting')
    const related = new Map<number, ReadonlySet<number>>([[1, new Set([9])]])
    const [item] = listSplittableLineEntries([original, split], ACCOUNTS, related, [{ splitEntryId: 9, sourceLineId: 1 }])
    expect(item.lines.map((l) => l.line.id)).toEqual([2, 3])
  })
})
