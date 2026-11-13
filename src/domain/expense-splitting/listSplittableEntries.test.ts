/**
 * listSplittableEntries(割勘タブの候補になる仕訳と、その費用の行・割勘する金額を返す純粋関数、
 * 計画Issue #153)のユニットテスト。割勘できる仕訳(checkExpenseSplittability)だけを残すこと、
 * 割勘する金額が借方の費用の行の合計になること(費用の行が複数ある仕訳は各行を同じ割合で割る)、
 * 関連仕訳に割勘済みの仕訳がある仕訳を除くことを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'
import { listSplittableEntries } from './listSplittableEntries'

function account(id: number, category: Account['category']): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
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

function line(accountId: number, side: 'debit' | 'credit', amount: number, id: number): JournalLine {
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

describe('listSplittableEntries', () => {
  it('借方に費用の行がある仕訳だけを候補にし、割勘する金額を費用の行の合計にする', () => {
    const lunch = entry(1, [line(FOOD, 'debit', 800, 1), line(CASH, 'credit', 800, 2)])
    const salary = entry(2, [line(CASH, 'debit', 300000, 3), line(SALARY, 'credit', 300000, 4)])

    const result = listSplittableEntries([lunch, salary], ACCOUNTS, new Map())

    expect(result.map((r) => r.entry.id)).toEqual([1])
    expect(result[0]).toMatchObject({ amount: 800 })
    expect(result[0].expenseLines.map((l) => l.id)).toEqual([1])
  })

  it('費用の行が複数ある仕訳は、費用の行の合計を割勘する金額にする', () => {
    const shopping = entry(1, [
      line(FOOD, 'debit', 800, 1),
      line(DAILY, 'debit', 200, 2),
      line(CASH, 'credit', 1000, 3),
    ])

    const [row] = listSplittableEntries([shopping], ACCOUNTS, new Map())

    expect(row.amount).toBe(1000)
    expect(row.expenseLines).toHaveLength(2)
  })

  it('割勘で作られた仕訳は候補にしない', () => {
    const split = entry(1, [line(FOOD, 'debit', 400, 1), line(CASH, 'credit', 400, 2)], 'expense_splitting')

    expect(listSplittableEntries([split], ACCOUNTS, new Map())).toEqual([])
  })

  it('関連仕訳に割勘で作られた仕訳がある(割勘済みの)仕訳は候補にしない', () => {
    const original = entry(1, [line(FOOD, 'debit', 800, 1), line(CASH, 'credit', 800, 2)])
    const split = entry(2, [line(FOOD, 'debit', 400, 3), line(CASH, 'credit', 400, 4)], 'expense_splitting')
    const related = new Map([[1, new Set([2])], [2, new Set([1])]])

    expect(listSplittableEntries([original, split], ACCOUNTS, related)).toEqual([])
  })
})
