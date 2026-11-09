import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Budget, CreateBudgetInput } from './Budget'

export type BudgetStatus = 'unset' | 'within' | 'over'

export interface BudgetProgressRow {
  accountId: number
  /** 予算額。未設定ならnull */
  budget: number | null
  /** 対象月の実績(借方合計−貸方合計) */
  actual: number
  /** 予算−実績。予算が未設定ならnull */
  remaining: number | null
  /** 実績÷予算(消化率)。予算が未設定ならnull。予算が0で実績があるときはInfinity */
  ratio: number | null
  status: BudgetStatus
}

export interface BudgetTotals {
  /** 設定されている予算の合計 */
  budget: number
  /** 予算のある科目の実績の合計 */
  budgetedActual: number
  remaining: number
  /** 予算のない費用科目の実績の合計 */
  unbudgetedActual: number
}

export interface BudgetProgressSummary {
  rows: BudgetProgressRow[]
  totals: BudgetTotals
}

function actualOf(entries: readonly JournalEntry[], yearMonth: string): Map<number, number> {
  const totals = new Map<number, number>()
  for (const entry of entries) {
    if (!entry.entryDate.startsWith(yearMonth)) continue
    for (const line of entry.lines) {
      const delta = line.side === 'debit' ? line.amount : -line.amount
      totals.set(line.accountId, (totals.get(line.accountId) ?? 0) + delta)
    }
  }
  return totals
}

/**
 * 対象月の予算と実績を、費用の科目ごとに突き合わせる(docs/domain/budgets.md 1.4、計画Issue #155)。
 * 予算残額 = 予算 −(借方合計 − 貸方合計)で、貸方の取消も実績に反映する。世帯メンバー等の絞り込みは
 * 適用しない。無効な科目は、対象月に予算か実績があるときだけ行に出す。DB非依存の純粋関数。
 */
export function summarizeBudgetProgress(
  budgets: readonly Budget[],
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  yearMonth: string,
): BudgetProgressSummary {
  const budgetByAccountId = new Map(
    budgets.filter((b) => b.yearMonth === yearMonth).map((b) => [b.accountId, b.amount]),
  )
  const actuals = actualOf(entries, yearMonth)

  const rows: BudgetProgressRow[] = accounts
    .filter((account) => account.category === 'expense')
    .filter(
      (account) =>
        account.isActive || budgetByAccountId.has(account.id) || (actuals.get(account.id) ?? 0) !== 0,
    )
    .map((account) => {
      const budget = budgetByAccountId.get(account.id) ?? null
      const actual = actuals.get(account.id) ?? 0
      if (budget === null) {
        return { accountId: account.id, budget, actual, remaining: null, ratio: null, status: 'unset' as const }
      }
      return {
        accountId: account.id,
        budget,
        actual,
        remaining: budget - actual,
        ratio: budget === 0 ? (actual > 0 ? Infinity : 0) : actual / budget,
        status: actual > budget ? ('over' as const) : ('within' as const),
      }
    })

  const budgeted = rows.filter((row) => row.budget !== null)
  const budget = budgeted.reduce((sum, row) => sum + (row.budget ?? 0), 0)
  const budgetedActual = budgeted.reduce((sum, row) => sum + row.actual, 0)
  const unbudgetedActual = rows.filter((row) => row.budget === null).reduce((sum, row) => sum + row.actual, 0)
  return { rows, totals: { budget, budgetedActual, remaining: budget - budgetedActual, unbudgetedActual } }
}

export interface BudgetCopyPlan {
  toCreate: CreateBudgetInput[]
  /** 対象月にすでに予算があり、上書きしなかった科目の数 */
  skippedCount: number
}

/**
 * 「先月の内容をコピー」の計画(docs/domain/budgets.md 1.3)。対象月にすでにある科目の予算は
 * 上書きせず、まだ無い科目だけを作成対象にする(計画Issue #155の確認事項に対する実装時判断)。
 */
export function planBudgetCopy(
  previousMonthBudgets: readonly Budget[],
  targetMonthBudgets: readonly Budget[],
  targetYearMonth: string,
): BudgetCopyPlan {
  const existing = new Set(targetMonthBudgets.map((b) => b.accountId))
  const toCreate = previousMonthBudgets
    .filter((b) => !existing.has(b.accountId))
    .map((b) => ({ accountId: b.accountId, yearMonth: targetYearMonth, amount: b.amount }))
  return { toCreate, skippedCount: previousMonthBudgets.length - toCreate.length }
}
