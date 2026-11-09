import type { Account } from '../account/Account'
import type { AccountGroup } from '../account-group/AccountGroup'
import type { JournalEntry } from '../journal/JournalEntry'
import type { FinancialStatementFilter } from '../financial-statement/FinancialStatementFilter'
import { generateFilteredBalanceSheet } from '../financial-statement/generateFilteredBalanceSheet'
import { generateFilteredProfitAndLoss } from '../financial-statement/generateFilteredProfitAndLoss'
import { getFirstDayOfMonth } from '../financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../financial-statement/getLastDayOfMonth'

/** 費用の「グループ別」の系列に入らない科目(グループ外・系列数の上限を超えたグループ)の系列キー */
export const OTHER_GROUP_KEY = 'other'

/** 積み上げに出す最上位グループの数の上限(超えた分は「その他」に入れる) */
export const MAX_EXPENSE_GROUP_SERIES = 5

export interface ExpenseGroupSeries {
  groupId: number
  name: string
}

export interface TopExpenseGroups {
  /** 系列にする最上位グループ(並び順どおり、最大5つ) */
  series: ExpenseGroupSeries[]
  /** 費用の科目id → 系列の最上位グループid。系列に入らない科目は含まない(「その他」) */
  groupIdByAccountId: Map<number, number>
}

/**
 * 費用の推移(グループ別)で積み上げる最上位グループを決める。入れ子のグループは最上位に
 * まとめる。最上位グループは並び順の先頭から5つまでを系列にし、それ以外とグループ外の科目は
 * 「その他」(groupIdByAccountIdに含めない)にする。DB非依存の純粋関数。
 */
export function resolveTopExpenseGroups(
  groups: readonly AccountGroup[],
  accounts: readonly Account[],
): TopExpenseGroups {
  const expenseGroups = groups.filter((group) => group.category === 'expense')
  const groupsById = new Map(expenseGroups.map((group) => [group.id, group]))
  const topOf = (groupId: number): AccountGroup | null => {
    let current = groupsById.get(groupId)
    const seen = new Set<number>()
    while (current && current.parentGroupId !== null && !seen.has(current.id)) {
      seen.add(current.id)
      current = groupsById.get(current.parentGroupId)
    }
    return current ?? null
  }

  const series = expenseGroups
    .filter((group) => group.parentGroupId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, MAX_EXPENSE_GROUP_SERIES)
    .map((group) => ({ groupId: group.id, name: group.name }))
  const seriesIds = new Set(series.map((s) => s.groupId))

  const groupIdByAccountId = new Map<number, number>()
  for (const account of accounts) {
    if (account.category !== 'expense' || account.accountGroupId === null) continue
    const top = topOf(account.accountGroupId)
    if (top && seriesIds.has(top.id)) groupIdByAccountId.set(account.id, top.id)
  }
  return { series, groupIdByAccountId }
}

export interface MonthlySummary {
  /** 'YYYY-MM' */
  month: string
  revenue: number
  expense: number
  net: number
  /** 月末時点のBSの純資産合計(初期残高+損益の累計) */
  equity: number
  /** 費用の最上位グループ別の合計。キーはグループid(文字列)か、「その他」のOTHER_GROUP_KEY。0の系列は含まない */
  expenseByGroup: Record<string, number>
}

/**
 * 月ごとの収益・費用・収支・月末の純資産と、費用の最上位グループ別の合計を求める
 * (分析画面のグラフ・月次表の元データ、計画Issue #155)。収益・費用は既存のPL生成、純資産は
 * 既存のBS生成(generateFilteredProfitAndLoss・generateFilteredBalanceSheet)を使うため、
 * 財務諸表タブの数字と一致する。絞り込みは各月に適用する。DB非依存の純粋関数。
 */
export function buildMonthlySummaries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  months: readonly string[],
  filter: FinancialStatementFilter,
  topGroups: TopExpenseGroups,
): MonthlySummary[] {
  return months.map((month) => {
    const year = Number(month.slice(0, 4))
    const monthNumber = Number(month.slice(5, 7))
    const from = getFirstDayOfMonth(year, monthNumber)
    const to = getLastDayOfMonth(year, monthNumber)
    const pl = generateFilteredProfitAndLoss(entries, accounts, from, to, filter)
    const bs = generateFilteredBalanceSheet(entries, accounts, to, filter)

    const expenseByGroup: Record<string, number> = {}
    for (const item of pl.expenses) {
      const groupId = topGroups.groupIdByAccountId.get(item.accountId)
      const key = groupId === undefined ? OTHER_GROUP_KEY : String(groupId)
      expenseByGroup[key] = (expenseByGroup[key] ?? 0) + item.amount
    }
    for (const key of Object.keys(expenseByGroup)) if (expenseByGroup[key] === 0) delete expenseByGroup[key]

    return {
      month,
      revenue: pl.totalRevenue,
      expense: pl.totalExpense,
      net: pl.netIncome,
      equity: bs.totalEquity,
      expenseByGroup,
    }
  })
}
