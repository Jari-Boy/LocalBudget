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
 * 間隔が2以上なら「3か月ごと1日」「2週ごと金曜日」のように「N回ごと」で表す(計画Issue #164)。
 */
export function describeRecurringSchedule(
  rule: RecurringTransactionRule,
  t: TFunction<'recurringTransaction'>,
): string {
  const n = rule.interval
  const every = n >= 2
  switch (rule.frequency) {
    case 'weekly': {
      const dayOfWeek = t(DAY_OF_WEEK_KEYS[rule.dayOfWeek ?? 0])
      return every ? t('scheduleEveryNWeeks', { n, dayOfWeek }) : t('scheduleWeekly', { dayOfWeek })
    }
    case 'monthly':
      if (rule.dayOfMonth !== null) {
        return every
          ? t('scheduleEveryNMonthsByDate', { n, day: rule.dayOfMonth })
          : t('scheduleMonthlyByDate', { day: rule.dayOfMonth })
      }
      {
        const week = t(WEEK_OF_MONTH_KEYS[rule.weekOfMonth ?? 1])
        const dayOfWeek = t(DAY_OF_WEEK_KEYS[rule.dayOfWeek ?? 0])
        return every
          ? t('scheduleEveryNMonthsByWeekday', { n, week, dayOfWeek })
          : t('scheduleMonthlyByWeekday', { week, dayOfWeek })
      }
    case 'yearly':
      return every
        ? t('scheduleEveryNYears', { n, month: rule.monthOfYear, day: rule.dayOfMonth })
        : t('scheduleYearly', { month: rule.monthOfYear, day: rule.dayOfMonth })
  }
}

/**
 * 繰り返しの補足(計画Issue #164)。土日の調整、終了日、回数の上限の順に、あるものだけを返す
 * (例: 「土日は前の平日」「2027/03/05まで」「24回まで」)。一覧の「繰り返し」欄で、繰り返しの文言の下に並べる。
 */
export function describeRecurringScheduleNotes(
  rule: RecurringTransactionRule,
  t: TFunction<'recurringTransaction'>,
): string[] {
  const notes: string[] = []
  if (rule.weekendAdjustment === 'next') notes.push(t('weekendNext'))
  if (rule.weekendAdjustment === 'previous') notes.push(t('weekendPrevious'))
  if (rule.endsOn !== null) notes.push(t('endsOnNote', { date: rule.endsOn.replaceAll('-', '/') }))
  if (rule.maxOccurrences !== null) notes.push(t('maxOccurrencesNote', { times: rule.maxOccurrences }))
  return notes
}
