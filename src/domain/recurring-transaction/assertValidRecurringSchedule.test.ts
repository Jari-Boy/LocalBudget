/**
 * assertValidRecurringSchedule(frequencyごとのカラム組み合わせ検証)の純粋関数としての
 * ユニットテスト。docs/domain/recurring-transactions.md 1.3の対応表(weekly→day_of_week、
 * monthly(日付指定)→day_of_month、monthly(曜日指定)→week_of_month+day_of_week、
 * yearly→month_of_year+day_of_month)通りの組み合わせのみを許可し、それ以外は
 * InvalidRecurringScheduleErrorをスローすることを検証する。計画Issue #164で追加した間隔(1以上の整数)と
 * 開始日・終了日の前後関係の検証も含む。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { assertValidRecurringSchedule } from './assertValidRecurringSchedule'
import { InvalidRecurringScheduleError } from './InvalidRecurringScheduleError'

describe('weekly', () => {
  it('day_of_weekのみ指定されている場合は許可する', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'weekly', dayOfWeek: 1 }),
    ).not.toThrow()
  })

  it('day_of_weekが未指定の場合はスローする', () => {
    expect(() => assertValidRecurringSchedule({ frequency: 'weekly' })).toThrow(
      InvalidRecurringScheduleError,
    )
  })

  it('day_of_monthも指定されている場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 15 }),
    ).toThrow(InvalidRecurringScheduleError)
  })
})

describe('monthly(日付指定)', () => {
  it('day_of_monthのみ指定されている場合は許可する', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'monthly', dayOfMonth: 25 }),
    ).not.toThrow()
  })

  it('day_of_monthとday_of_week/week_of_monthが両方指定されている場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({
        frequency: 'monthly',
        dayOfMonth: 25,
        dayOfWeek: 1,
        weekOfMonth: 2,
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })
})

describe('monthly(曜日指定)', () => {
  it('day_of_week + week_of_monthが指定されている場合は許可する', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'monthly', dayOfWeek: 6, weekOfMonth: 2 }),
    ).not.toThrow()
  })

  it('week_of_monthのみでday_of_weekが無い場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'monthly', weekOfMonth: 2 }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('day_of_weekのみでweek_of_monthが無い場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'monthly', dayOfWeek: 6 }),
    ).toThrow(InvalidRecurringScheduleError)
  })
})

describe('monthly共通', () => {
  it('month_of_yearが指定されている場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'monthly', dayOfMonth: 25, monthOfYear: 6 }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('どのカラムも指定されていない場合はスローする', () => {
    expect(() => assertValidRecurringSchedule({ frequency: 'monthly' })).toThrow(
      InvalidRecurringScheduleError,
    )
  })
})

describe('yearly', () => {
  it('month_of_year + day_of_monthが指定されている場合は許可する', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'yearly', monthOfYear: 6, dayOfMonth: 1 }),
    ).not.toThrow()
  })

  it('month_of_yearが未指定の場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'yearly', dayOfMonth: 1 }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('day_of_monthが未指定の場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({ frequency: 'yearly', monthOfYear: 6 }),
    ).toThrow(InvalidRecurringScheduleError)
  })

  it('day_of_week/week_of_monthが指定されている場合はスローする', () => {
    expect(() =>
      assertValidRecurringSchedule({
        frequency: 'yearly',
        monthOfYear: 6,
        dayOfMonth: 1,
        dayOfWeek: 1,
      }),
    ).toThrow(InvalidRecurringScheduleError)
  })
})

describe('間隔・開始日・終了日(計画Issue #164)', () => {
  const monthly = { frequency: 'monthly', dayOfMonth: 25 } as const

  it('間隔が1以上の整数なら許可する(省略時は1として扱う)', () => {
    expect(() => assertValidRecurringSchedule(monthly)).not.toThrow()
    expect(() => assertValidRecurringSchedule({ ...monthly, interval: 3 })).not.toThrow()
  })

  it('間隔が0以下・小数の場合はInvalidRecurringScheduleErrorを投げる', () => {
    expect(() => assertValidRecurringSchedule({ ...monthly, interval: 0 })).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidRecurringSchedule({ ...monthly, interval: -1 })).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidRecurringSchedule({ ...monthly, interval: 1.5 })).toThrow(InvalidRecurringScheduleError)
  })

  it('終了日が開始日より前の場合はInvalidRecurringScheduleErrorを投げる(同じ日は許可する)', () => {
    expect(() =>
      assertValidRecurringSchedule({ ...monthly, startsOn: '2026-05-01', endsOn: '2026-04-30' }),
    ).toThrow(InvalidRecurringScheduleError)
    expect(() =>
      assertValidRecurringSchedule({ ...monthly, startsOn: '2026-05-01', endsOn: '2026-05-01' }),
    ).not.toThrow()
  })
})
