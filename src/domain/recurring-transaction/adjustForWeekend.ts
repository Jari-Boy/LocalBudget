import type { WeekendAdjustment } from './RecurringTransactionRule'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * 期日が土曜・日曜のとき、土日の調整(計画Issue #164)に従って日付をずらす純粋関数。
 * next=翌平日(月曜日)、previous=前平日(金曜日)、none=そのまま。祝日は考慮しない
 * (祝日データという外部依存を増やさないため)。調整後の日付が仕訳のentry_dateになる。
 */
export function adjustForWeekend(date: string, adjustment: WeekendAdjustment): string {
  if (adjustment === 'none') return date

  const [year, month, day] = date.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day)
  const dayOfWeek = new Date(ms).getUTCDay()

  let shiftDays = 0
  if (dayOfWeek === 6) shiftDays = adjustment === 'next' ? 2 : -1
  if (dayOfWeek === 0) shiftDays = adjustment === 'next' ? 1 : -2

  return new Date(ms + shiftDays * ONE_DAY_MS).toISOString().slice(0, 10)
}
