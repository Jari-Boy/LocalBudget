import { getFirstDayOfMonth } from '../../../domain/financial-statement/getFirstDayOfMonth'
import { getLastDayOfMonth } from '../../../domain/financial-statement/getLastDayOfMonth'

/**
 * 期間入力(日付/月の切替、計画Issue #314)の純粋関数。条件のモデルは dateFrom/dateTo のままで、月モードは
 * 「開始月の1日〜終了月の末日」への変換だけを行う。日付は 'YYYY-MM-DD'、月は 'YYYY-MM'、空文字は「指定なし」。
 * DB・DOM非依存。
 */
export interface DateRange {
  from: string
  to: string
}

/** 日付から、含まれる月('YYYY-MM')を返す。空文字は空文字 */
export function monthOf(date: string): string {
  return date === '' ? '' : date.slice(0, 7)
}

function yearMonthOf(month: string): { year: number; month: number } {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) }
}

/** 開始月は月初日、終了月は月末日にする。「指定なし」(空文字)の側は空にする */
export function monthToDateRange(fromMonth: string, toMonth: string): DateRange {
  const from = fromMonth === '' ? '' : getFirstDayOfMonth(yearMonthOf(fromMonth).year, yearMonthOf(fromMonth).month)
  const to = toMonth === '' ? '' : getLastDayOfMonth(yearMonthOf(toMonth).year, yearMonthOf(toMonth).month)
  return { from, to }
}

/** 日付の範囲を、含まれる月の月初〜月末に広げる(日付から月へ切り替えたとき)。空の側は空のまま */
export function snapRangeToMonths(range: DateRange): DateRange {
  return monthToDateRange(monthOf(range.from), monthOf(range.to))
}

function toIndex(month: string): number {
  const { year, month: m } = yearMonthOf(month)
  return year * 12 + (m - 1)
}

function fromIndex(index: number): string {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** 開始が月初・終了が月末(または指定なし)で、月の指定として表せるか。月の途中の日付が入っていれば false */
export function isMonthAligned(range: DateRange): boolean {
  const snapped = snapRangeToMonths(range)
  return snapped.from === range.from && snapped.to === range.to
}

/**
 * 月の選択肢('YYYY-MM'、新しい順)。仕訳の日付の最も古い月から最も新しい月まで途切れなく並べ、選択中の月が
 * その範囲の外にあっても含める(選択が消えないように)。どちらも無ければ空
 */
export function buildMonthOptions(dates: readonly string[], selectedMonths: readonly string[]): string[] {
  // 仕訳が数万件あっても配列の展開で溢れないよう、最小・最大は1件ずつ見て求める
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const take = (month: string) => {
    if (month === '') return
    const index = toIndex(month)
    if (index < min) min = index
    if (index > max) max = index
  }
  for (const date of dates) take(monthOf(date))
  for (const month of selectedMonths) take(month)
  if (min > max) return []
  return Array.from({ length: max - min + 1 }, (_, offset) => fromIndex(max - offset))
}
