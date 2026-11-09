/**
 * summarizeBudgetProgress・planBudgetCopy(分析画面の予算タブ、計画Issue #155)のユニットテスト。
 * docs/domain/budgets.md 1.4の式(予算残額 = 予算 − (借方合計 − 貸方合計))で、科目ごとの
 * 予算・実績・残り・消化率・状態(未設定・範囲内・超過)と、予算の合計・予算のない費用を求める。
 * 貸方の取消は実績から差し引く。「先月の内容をコピー」は、対象月にすでにある予算を上書きしない。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Budget } from './Budget'
import { planBudgetCopy, summarizeBudgetProgress } from './summarizeBudgetProgress'

function account(id: number, name: string, isActive = true): Account {
  return {
    id,
    category: 'expense',
    name,
    isReconcilable: null,
    isActive,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
  }
}

function budget(id: number, accountId: number, yearMonth: string, amount: number): Budget {
  return { id, accountId, yearMonth, amount, createdAt: '', updatedAt: '' }
}

function entry(id: number, entryDate: string, accountId: number, side: 'debit' | 'credit', amount: number): JournalEntry {
  return {
    id,
    entryDate,
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '',
    updatedAt: '',
    lines: [
      {
        id: id * 10,
        journalEntryId: id,
        accountId,
        projectId: null,
        householdMemberId: 1,
        counterpartyId: null,
        settlementBatchId: null,
        side,
        amount,
        createdAt: '',
      },
    ],
  }
}

const accounts = [account(1, '食費'), account(2, '交通費'), account(3, '社会保険料'), account(4, '旧科目', false)]

describe('summarizeBudgetProgress', () => {
  const entries = [
    entry(1, '2026-10-05', 1, 'debit', 30000),
    entry(2, '2026-10-06', 1, 'credit', 2000),
    entry(3, '2026-10-07', 2, 'debit', 6000),
    entry(4, '2026-10-08', 3, 'debit', 15000),
    entry(5, '2026-11-01', 1, 'debit', 999),
  ]
  const budgets = [budget(1, 1, '2026-10', 25000), budget(2, 2, '2026-10', 5000)]

  it('実績は対象月の借方合計から貸方合計を引いた額で、貸方の取消も反映する', () => {
    const summary = summarizeBudgetProgress(budgets, accounts, entries, '2026-10')
    expect(summary.rows.find((r) => r.accountId === 1)?.actual).toBe(28000)
  })

  it('残り・消化率・状態を、予算のある科目ごとに求める', () => {
    const summary = summarizeBudgetProgress(budgets, accounts, entries, '2026-10')
    const food = summary.rows.find((r) => r.accountId === 1)!
    expect([food.budget, food.remaining, food.status]).toEqual([25000, -3000, 'over'])
    expect(food.ratio).toBeCloseTo(1.12)
    const transport = summary.rows.find((r) => r.accountId === 2)!
    expect([transport.remaining, transport.status]).toEqual([-1000, 'over'])
  })

  it('実績が予算以下なら範囲内、ちょうど予算と同じ額も範囲内', () => {
    const summary = summarizeBudgetProgress([budget(1, 1, '2026-10', 28000)], accounts, entries, '2026-10')
    expect(summary.rows.find((r) => r.accountId === 1)?.status).toBe('within')
  })

  it('予算が未設定の科目は、状態が未設定で残りを持たない', () => {
    const summary = summarizeBudgetProgress(budgets, accounts, entries, '2026-10')
    const insurance = summary.rows.find((r) => r.accountId === 3)!
    expect([insurance.budget, insurance.remaining, insurance.status]).toEqual([null, null, 'unset'])
  })

  it('予算額0の科目は、実績が0を超えれば超過になる', () => {
    const summary = summarizeBudgetProgress([budget(1, 3, '2026-10', 0)], accounts, entries, '2026-10')
    expect(summary.rows.find((r) => r.accountId === 3)?.status).toBe('over')
  })

  it('合計は、予算の合計・予算のある科目の実績・残り・予算のない費用を返す', () => {
    const summary = summarizeBudgetProgress(budgets, accounts, entries, '2026-10')
    expect(summary.totals).toEqual({ budget: 30000, budgetedActual: 34000, remaining: -4000, unbudgetedActual: 15000 })
  })

  it('対象月の予算だけを使い、他の月の予算は無視する', () => {
    const summary = summarizeBudgetProgress([budget(9, 1, '2026-09', 99999)], accounts, entries, '2026-10')
    expect(summary.totals.budget).toBe(0)
  })

  it('無効な科目は、対象月に予算か実績があるときだけ行に出す', () => {
    const none = summarizeBudgetProgress(budgets, accounts, entries, '2026-10')
    expect(none.rows.some((r) => r.accountId === 4)).toBe(false)
    const withBudget = summarizeBudgetProgress([...budgets, budget(3, 4, '2026-10', 1000)], accounts, entries, '2026-10')
    expect(withBudget.rows.some((r) => r.accountId === 4)).toBe(true)
  })

  it('費用以外の科目は行に出さない', () => {
    const withAsset = [...accounts, { ...account(5, '現金'), category: 'asset' as const }]
    const summary = summarizeBudgetProgress(budgets, withAsset, entries, '2026-10')
    expect(summary.rows.some((r) => r.accountId === 5)).toBe(false)
  })
})

describe('planBudgetCopy', () => {
  it('前月の予算のうち、対象月にまだ無い科目だけを作成対象にする', () => {
    const plan = planBudgetCopy(
      [budget(1, 1, '2026-09', 30000), budget(2, 2, '2026-09', 5000)],
      [budget(3, 2, '2026-10', 7000)],
      '2026-10',
    )
    expect(plan.toCreate).toEqual([{ accountId: 1, yearMonth: '2026-10', amount: 30000 }])
    expect(plan.skippedCount).toBe(1)
  })

  it('前月の予算が無ければ何も作らない', () => {
    expect(planBudgetCopy([], [], '2026-10')).toEqual({ toCreate: [], skippedCount: 0 })
  })
})
