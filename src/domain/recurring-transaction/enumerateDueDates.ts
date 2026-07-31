import type { RecurringTransactionRule } from './RecurringTransactionRule'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// 通常の運用でこの日数以内に必ず次回発生日が見つかる(週次・月次・年次いずれの
// パターンでも数年以内に収まる)ため、無限ループ化を防ぐ安全装置として上限を設ける。
const MAX_SEARCH_DAYS = 3660

/**
 * ルールの次回発生日を計算する純粋関数(docs/domain/recurring-transactions.md 1.3)。
 * after(前回チェック日または直前の発生日)より後(exclusive)で最初にルールに合致する日付を返す。
 * day_of_monthがその月に存在しない場合(31日等)は月末に丸める(#18コメントで確定した設計判断)。
 * DBアクセスを一切行わない。
 */
export function nextOccurrenceDate(rule: RecurringTransactionRule, after: string): string {
  let ms = parseISODate(after) + ONE_DAY_MS
  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    if (matchesSchedule(rule, ms)) {
      return formatISODate(ms)
    }
    ms += ONE_DAY_MS
  }
  throw new Error(`no occurrence found within ${MAX_SEARCH_DAYS} days after ${after}`)
}

/**
 * 前回チェック日(since、exclusive)から現在(until、inclusive)までの間にルールが
 * 発生すべき対象日を列挙する純粋関数。max_occurrencesが設定されているルールは、
 * generatedCount(既に生成済みの件数)との差分までしか列挙しない
 * (docs/domain/recurring-transactions.md 1.6・2.1)。
 */
export function enumerateDueDates(
  rule: RecurringTransactionRule,
  range: { since: string; until: string },
  generatedCount: number,
): string[] {
  const remaining =
    rule.maxOccurrences === null ? Infinity : Math.max(0, rule.maxOccurrences - generatedCount)

  const results: string[] = []
  let cursor = range.since
  while (results.length < remaining) {
    let next: string
    try {
      next = nextOccurrenceDate(rule, cursor)
    } catch {
      break
    }
    if (next > range.until) break
    results.push(next)
    cursor = next
  }
  return results
}

function matchesSchedule(rule: RecurringTransactionRule, ms: number): boolean {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const dayOfWeek = date.getUTCDay()

  switch (rule.frequency) {
    case 'weekly':
      return dayOfWeek === rule.dayOfWeek
    case 'monthly':
      if (rule.dayOfMonth !== null) {
        return day === clampDayOfMonth(year, month, rule.dayOfMonth)
      }
      return day === nthWeekdayOfMonth(year, month, rule.dayOfWeek!, rule.weekOfMonth!)
    case 'yearly':
      return month === rule.monthOfYear && day === clampDayOfMonth(year, month, rule.dayOfMonth!)
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function clampDayOfMonth(year: number, month: number, dayOfMonth: number): number {
  return Math.min(dayOfMonth, daysInMonth(year, month))
}

/** weekOfMonthが-1の場合は月内最後の該当曜日、それ以外は第N週の該当曜日の日付を返す(存在しなければnull) */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  weekOfMonth: number,
): number | null {
  const lastDay = daysInMonth(year, month)

  if (weekOfMonth === -1) {
    for (let day = lastDay; day > lastDay - 7; day--) {
      if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() === dayOfWeek) {
        return day
      }
    }
    return null
  }

  const firstDayOfWeek = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const offsetToFirstMatch = (dayOfWeek - firstDayOfWeek + 7) % 7
  const day = 1 + offsetToFirstMatch + (weekOfMonth - 1) * 7
  return day <= lastDay ? day : null
}

function parseISODate(value: string): number {
  const [year, month, day] = value.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function formatISODate(ms: number): string {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
