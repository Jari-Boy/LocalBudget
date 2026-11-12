import type { RecurringTransactionRule } from './RecurringTransactionRule'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
// 通常の運用でこの日数以内に必ず次回発生日が見つかる(週次・月次・年次いずれの
// パターンでも数年以内に収まる)ため、無限ループ化を防ぐ安全装置として上限を設ける。
const MAX_SEARCH_DAYS = 3660
const WEEK_MS = 7 * ONE_DAY_MS

/**
 * ルールの次回発生日を計算する純粋関数(docs/domain/recurring-transactions.md 1.3)。
 * after(前回チェック日または直前の発生日)より後(exclusive)で最初にルールに合致する日付を返す。
 * day_of_monthがその月に存在しない場合(31日等)は月末に丸める(#18コメントで確定した設計判断)。
 * 間隔(N回ごと)がある場合は、開始日を基準にした周期に合う日だけを返す(計画Issue #164)。開始日
 * より前の日は返さない。DBアクセスを一切行わない。
 */
export function nextOccurrenceDate(rule: RecurringTransactionRule, after: string): string {
  let ms = parseISODate(after) + ONE_DAY_MS
  // 間隔が大きいほど次の周期までの日数が伸びるため、探索の上限も間隔に比例させる
  for (let i = 0; i < MAX_SEARCH_DAYS * rule.interval; i++) {
    if (matchesSchedule(rule, ms)) {
      return formatISODate(ms)
    }
    ms += ONE_DAY_MS
  }
  throw new Error(`no occurrence found within ${MAX_SEARCH_DAYS * rule.interval} days after ${after}`)
}

/**
 * 前回チェック日(since、exclusive)から現在(until、inclusive)までの間にルールが
 * 発生すべき対象日を列挙する純粋関数。max_occurrencesが設定されているルールは、
 * generatedCount(既に生成済みの件数)との差分までしか列挙しない
 * (docs/domain/recurring-transactions.md 1.6・2.1)。終了日(当日を含む)を過ぎた対象日も列挙しない
 * ため、回数の上限と終了日の両方があれば先に来たほうで止まる(計画Issue #164)。
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
    if (rule.endsOn !== null && next > rule.endsOn) break
    results.push(next)
    cursor = next
  }
  return results
}

function matchesSchedule(rule: RecurringTransactionRule, ms: number): boolean {
  return ms >= parseISODate(rule.startsOn) && inCycle(rule, ms) && matchesPattern(rule, ms)
}

/**
 * 間隔(N回ごと)の周期に合う日か。周期の基準は開始日で、毎週なら開始日を含む週(月曜始まり)を
 * 1回目、毎月なら開始日の月、毎年なら開始日の年を1回目と数える(計画Issue #164)。起点(再開日など)
 * には依存しないため、再有効化しても周期はずれない。
 */
function inCycle(rule: RecurringTransactionRule, ms: number): boolean {
  if (rule.interval === 1) return true

  const start = parseISODate(rule.startsOn)
  const date = new Date(ms)
  const startDate = new Date(start)
  switch (rule.frequency) {
    case 'weekly':
      return Math.round((mondayOf(ms) - mondayOf(start)) / WEEK_MS) % rule.interval === 0
    case 'monthly':
      return (
        ((date.getUTCFullYear() - startDate.getUTCFullYear()) * 12 +
          (date.getUTCMonth() - startDate.getUTCMonth())) %
          rule.interval ===
        0
      )
    case 'yearly':
      return (date.getUTCFullYear() - startDate.getUTCFullYear()) % rule.interval === 0
  }
}

function mondayOf(ms: number): number {
  return ms - ((new Date(ms).getUTCDay() + 6) % 7) * ONE_DAY_MS
}

function matchesPattern(rule: RecurringTransactionRule, ms: number): boolean {
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
