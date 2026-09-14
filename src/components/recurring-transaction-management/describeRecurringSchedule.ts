import type { TFunction } from 'i18next'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'

const DAY_OF_WEEK_KEYS = [
  'dayOfWeekSun',
  'dayOfWeekMon',
  'dayOfWeekTue',
  'dayOfWeekWed',
  'dayOfWeekThu',
  'dayOfWeekFri',
  'dayOfWeekSat',
] as const

const WEEK_OF_MONTH_KEYS: Record<number, string> = {
  1: 'weekOfMonth1',
  2: 'weekOfMonth2',
  3: 'weekOfMonth3',
  4: 'weekOfMonth4',
  5: 'weekOfMonth5',
  [-1]: 'weekOfMonthLast',
}

/**
 * RecurringTransactionRuleのfrequency・day_of_week等のカラム組み合わせ
 * (docs/domain/recurring-transactions.md 1.3節の対応表、assertValidRecurringScheduleが
 * 検証する4パターン)から、一覧表示用の人間可読なスケジュール文字列を生成する純粋関数。
 */
export function describeRecurringSchedule(
  rule: RecurringTransactionRule,
  t: TFunction<'recurringTransaction'>,
): string {
  switch (rule.frequency) {
    case 'weekly':
      return t('scheduleWeekly', { dayOfWeek: t(DAY_OF_WEEK_KEYS[rule.dayOfWeek ?? 0]) })
    case 'monthly':
      if (rule.dayOfMonth !== null) {
        return t('scheduleMonthlyByDate', { day: rule.dayOfMonth })
      }
      return t('scheduleMonthlyByWeekday', {
        week: t(WEEK_OF_MONTH_KEYS[rule.weekOfMonth ?? 1]),
        dayOfWeek: t(DAY_OF_WEEK_KEYS[rule.dayOfWeek ?? 0]),
      })
    case 'yearly':
      return t('scheduleYearly', { month: rule.monthOfYear, day: rule.dayOfMonth })
  }
}
