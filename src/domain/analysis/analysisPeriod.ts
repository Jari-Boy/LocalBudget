import type { Period } from '../financial-statement/Period'
import { getFirstDayOfMonth } from '../financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../financial-statement/getLastDayOfMonth'
import { getPreviousPeriod } from '../financial-statement/getPreviousPeriod'
import { getPreviousYearPeriod } from '../financial-statement/getPreviousYearPeriod'

export type AnalysisPresetKey = 'thisMonth' | 'last3Months' | 'thisYear' | 'last12Months' | 'lastYear'
export type AnalysisComparisonMode = 'none' | 'previousPeriod' | 'previousYear'

/** 推移グラフに出す最低限の月数(期間が短くても、終了月を末尾にこの月数を出す) */
export const TREND_WINDOW_MONTHS = 12

function toYearMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

function fromYearMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

function formatYearMonth(index: number): string {
  const { year, month } = fromYearMonthIndex(index)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function indexOfDate(date: string): number {
  return toYearMonthIndex(Number(date.slice(0, 4)), Number(date.slice(5, 7)))
}

/**
 * 分析画面の期間プリセット(計画Issue #155)。いずれも月初から月末までの月単位の期間で、
 * 「今日」を含む月を基準にする。DB非依存の純粋関数。
 */
export function resolvePresetPeriod(key: AnalysisPresetKey, today: string): Period {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const currentIndex = toYearMonthIndex(year, month)
  const endOfCurrentMonth = getLastDayOfMonth(year, month)

  const monthsBack = (count: number): Period => {
    const start = fromYearMonthIndex(currentIndex - (count - 1))
    return { from: getFirstDayOfMonth(start.year, start.month), to: endOfCurrentMonth }
  }

  switch (key) {
    case 'thisMonth':
      return monthsBack(1)
    case 'last3Months':
      return monthsBack(3)
    case 'last12Months':
      return monthsBack(12)
    case 'thisYear':
      return { from: getFirstDayOfMonth(year, 1), to: endOfCurrentMonth }
    case 'lastYear':
      return { from: getFirstDayOfMonth(year - 1, 1), to: getLastDayOfMonth(year - 1, 12) }
  }
}

/** 期間の開始日・終了日を含む月('YYYY-MM')を古い順に列挙する。 */
export function listMonthsOfPeriod(period: Period): string[] {
  const start = indexOfDate(period.from)
  const end = indexOfDate(period.to)
  const months: string[] = []
  for (let index = start; index <= end; index++) months.push(formatYearMonth(index))
  return months
}

/**
 * 推移のグラフに出す月。期間が12か月未満でも終了月を末尾にした直近12か月を出し、
 * 12か月を超えるときは期間の開始月から終了月までをすべて出す。
 */
export function resolveTrendWindowMonths(period: Period): string[] {
  const end = indexOfDate(period.to)
  const start = Math.min(indexOfDate(period.from), end - (TREND_WINDOW_MONTHS - 1))
  const months: string[] = []
  for (let index = start; index <= end; index++) months.push(formatYearMonth(index))
  return months
}

/** 比較期間。前期・前年同期は既存の財務諸表の定義(getPreviousPeriod・getPreviousYearPeriod)を維持する。 */
export function resolveComparisonPeriod(period: Period, mode: AnalysisComparisonMode): Period | null {
  if (mode === 'previousPeriod') return getPreviousPeriod(period)
  if (mode === 'previousYear') return getPreviousYearPeriod(period)
  return null
}
