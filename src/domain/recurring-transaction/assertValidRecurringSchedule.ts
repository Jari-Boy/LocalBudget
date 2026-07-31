import type { RecurringTransactionFrequency } from './RecurringTransactionRule'
import { InvalidRecurringScheduleError } from './InvalidRecurringScheduleError'

interface ScheduleColumns {
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
}

/**
 * frequencyごとに使用すべきカラムの組み合わせ(docs/domain/recurring-transactions.md 1.3の
 * 対応表、docs/schema/recurring_transactions.sql のCHECK制約と同一のルール)を検証する
 * 純粋関数。組み合わせに反する場合はInvalidRecurringScheduleErrorをスローする。
 */
export function assertValidRecurringSchedule(input: ScheduleColumns): void {
  const dayOfWeek = input.dayOfWeek ?? null
  const dayOfMonth = input.dayOfMonth ?? null
  const weekOfMonth = input.weekOfMonth ?? null
  const monthOfYear = input.monthOfYear ?? null

  switch (input.frequency) {
    case 'weekly':
      if (dayOfWeek === null || dayOfMonth !== null || weekOfMonth !== null || monthOfYear !== null) {
        throw new InvalidRecurringScheduleError(
          `weekly requires dayOfWeek only: got ${describe(input)}`,
        )
      }
      return
    case 'monthly': {
      if (monthOfYear !== null) {
        throw new InvalidRecurringScheduleError(
          `monthly must not have monthOfYear: got ${describe(input)}`,
        )
      }
      const byDayOfMonth = dayOfMonth !== null && dayOfWeek === null && weekOfMonth === null
      const byWeekday = dayOfWeek !== null && weekOfMonth !== null && dayOfMonth === null
      if (!byDayOfMonth && !byWeekday) {
        throw new InvalidRecurringScheduleError(
          `monthly requires either dayOfMonth only, or dayOfWeek+weekOfMonth: got ${describe(input)}`,
        )
      }
      return
    }
    case 'yearly':
      if (monthOfYear === null || dayOfMonth === null || dayOfWeek !== null || weekOfMonth !== null) {
        throw new InvalidRecurringScheduleError(
          `yearly requires monthOfYear+dayOfMonth only: got ${describe(input)}`,
        )
      }
      return
  }
}

function describe(input: ScheduleColumns): string {
  return JSON.stringify(input)
}
