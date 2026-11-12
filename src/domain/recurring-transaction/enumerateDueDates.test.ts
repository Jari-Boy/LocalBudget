/**
 * nextOccurrenceDate(次回発生日の計算)・enumerateDueDates(前回チェック日〜現在の間に
 * 発生すべき対象日の列挙)の純粋関数としてのユニットテスト。
 * docs/domain/recurring-transactions.md 1.3の繰り返しルール(weekly/monthly(日付指定)/
 * monthly(曜日指定)/yearly)ごとの次回発生日計算、31日等その月に存在しない日付を指定した
 * 場合に月末へ丸める処理(#18コメントで確定した設計判断)、max_occurrencesに達した
 * ルールが以降の対象日を列挙しないことを検証する。計画Issue #164で追加した間隔(N回ごと、周期の
 * 基準は開始日)・開始日(当日を含む)・終了日(当日を含む、回数の上限との先着)も検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from './RecurringTransactionRule'
import { enumerateDueDates, nextOccurrenceDate } from './enumerateDueDates'

function makeRule(overrides: Partial<RecurringTransactionRule>): RecurringTransactionRule {
  return {
    id: 1,
    name: 'テストルール',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: 1000,
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 1,
    weekOfMonth: null,
    monthOfYear: null,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    maxOccurrences: null,
    startsOn: '2000-01-01',
    endsOn: null,
    interval: 1,
    weekendAdjustment: 'none',
    amountMode: 'fixed',
    resumedOn: null,
    isActive: true,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    ...overrides,
  }
}

describe('nextOccurrenceDate', () => {
  it('weekly: 指定曜日の直後の発生日を返す(2026-08-01は土曜日、次の月曜日は2026-08-03)', () => {
    const rule = makeRule({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null })

    expect(nextOccurrenceDate(rule, '2026-08-01')).toBe('2026-08-03')
  })

  it('weekly: afterが対象曜日そのものでも次週の同曜日を返す(exclusive)', () => {
    const rule = makeRule({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: null })

    expect(nextOccurrenceDate(rule, '2026-08-03')).toBe('2026-08-10')
  })

  it('monthly(日付指定): 指定日の翌月分を返す', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 25 })

    expect(nextOccurrenceDate(rule, '2026-08-25')).toBe('2026-09-25')
  })

  it('monthly(日付指定): 当月分がまだ来ていなければ当月分を返す', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 25 })

    expect(nextOccurrenceDate(rule, '2026-08-01')).toBe('2026-08-25')
  })

  it('monthly(日付指定): day_of_month=31は2月では28日(平年)に丸める', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 31 })

    expect(nextOccurrenceDate(rule, '2026-01-31')).toBe('2026-02-28')
  })

  it('monthly(日付指定): day_of_month=31は閏年2月では29日に丸める', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 31 })

    expect(nextOccurrenceDate(rule, '2028-01-31')).toBe('2028-02-29')
  })

  it('monthly(日付指定): day_of_month=31は4月では30日に丸める', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 31 })

    expect(nextOccurrenceDate(rule, '2026-03-31')).toBe('2026-04-30')
  })

  it('monthly(日付指定): day_of_month=31の月はそのまま31日を返す', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 31 })

    expect(nextOccurrenceDate(rule, '2026-04-30')).toBe('2026-05-31')
  })

  it('monthly(曜日指定): 第2土曜日を返す(2026年8月の第2土曜日は8/8)', () => {
    const rule = makeRule({
      frequency: 'monthly',
      dayOfMonth: null,
      dayOfWeek: 6,
      weekOfMonth: 2,
    })

    expect(nextOccurrenceDate(rule, '2026-08-01')).toBe('2026-08-08')
  })

  it('monthly(曜日指定): 最終週(-1)は月の最後の該当曜日を返す(2026年8月最後の月曜日は8/31)', () => {
    const rule = makeRule({
      frequency: 'monthly',
      dayOfMonth: null,
      dayOfWeek: 1,
      weekOfMonth: -1,
    })

    expect(nextOccurrenceDate(rule, '2026-08-01')).toBe('2026-08-31')
  })

  it('monthly(曜日指定): 該当月に第5該当曜日が存在しない場合は次に存在する月まで探す', () => {
    // 2026年8月の水曜日は8/5,12,19,26の4回のみで第5水曜日が存在しない。
    // 次に第5水曜日が存在するのは2026年9月(9/2,9,16,23,30の5回、第5水曜日は9/30)。
    const rule = makeRule({
      frequency: 'monthly',
      dayOfMonth: null,
      dayOfWeek: 3,
      weekOfMonth: 5,
    })

    expect(nextOccurrenceDate(rule, '2026-08-01')).toBe('2026-09-30')
  })

  it('yearly: 指定月日の翌年分を返す', () => {
    const rule = makeRule({ frequency: 'yearly', dayOfMonth: 1, monthOfYear: 6 })

    expect(nextOccurrenceDate(rule, '2026-06-01')).toBe('2027-06-01')
  })

  it('yearly: 2/29指定は平年では2/28に丸める', () => {
    const rule = makeRule({ frequency: 'yearly', dayOfMonth: 29, monthOfYear: 2 })

    expect(nextOccurrenceDate(rule, '2026-01-01')).toBe('2026-02-28')
  })

  it('yearly: 2/29指定は閏年ではそのまま2/29を返す', () => {
    const rule = makeRule({ frequency: 'yearly', dayOfMonth: 29, monthOfYear: 2 })

    expect(nextOccurrenceDate(rule, '2027-03-01')).toBe('2028-02-29')
  })
})

describe('enumerateDueDates', () => {
  it('前回チェック日(since)を含まず、現在日(until)を含む範囲で対象日を列挙する', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1 })

    const dates = enumerateDueDates(rule, { since: '2026-06-01', until: '2026-08-01' }, 0)

    expect(dates).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('sinceとuntilが同じ日付の場合は何も返さない', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1 })

    expect(enumerateDueDates(rule, { since: '2026-08-01', until: '2026-08-01' }, 0)).toEqual([])
  })

  it('対象日が範囲内に存在しない場合は空配列を返す', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 25 })

    expect(enumerateDueDates(rule, { since: '2026-08-01', until: '2026-08-10' }, 0)).toEqual([])
  })

  it('max_occurrencesに達していないルールは残り回数分のみ列挙する', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, maxOccurrences: 3 })

    const dates = enumerateDueDates(
      rule,
      { since: '2026-05-01', until: '2026-09-01' },
      2, // 既に2件生成済み → 残り1件のみ
    )

    expect(dates).toEqual(['2026-06-01'])
  })

  it('max_occurrencesに達したルールは以降の対象日を列挙しない', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, maxOccurrences: 3 })

    const dates = enumerateDueDates(rule, { since: '2026-05-01', until: '2026-09-01' }, 3)

    expect(dates).toEqual([])
  })

  it('max_occurrences=nullの場合は無制限に列挙する', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, maxOccurrences: null })

    const dates = enumerateDueDates(rule, { since: '2026-01-01', until: '2026-12-01' }, 100)

    expect(dates).toHaveLength(11)
  })
})

describe('間隔(計画Issue #164)', () => {
  it('monthly: 3か月ごとは開始日の月を1回目として、1・4・7・10月に発生する', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, interval: 3, startsOn: '2026-01-01' })

    expect(enumerateDueDates(rule, { since: '2025-12-31', until: '2026-12-31' }, 0)).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ])
  })

  it('monthly: 起点を途中にしても周期は開始日の月から数える(1月開始の3か月ごとは、2月以降でも4月・7月)', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, interval: 3, startsOn: '2026-01-01' })

    expect(enumerateDueDates(rule, { since: '2026-02-01', until: '2026-08-01' }, 1)).toEqual([
      '2026-04-01',
      '2026-07-01',
    ])
  })

  it('weekly: 隔週は開始日を含む週(月曜始まり)を1回目として、2週おきの同じ曜日に発生する', () => {
    // 2026-01-07は水曜日。開始日を含む週(1/5〜1/11)の金曜日=1/9が1回目
    const rule = makeRule({ frequency: 'weekly', dayOfWeek: 5, dayOfMonth: null, interval: 2, startsOn: '2026-01-07' })

    expect(enumerateDueDates(rule, { since: '2026-01-06', until: '2026-02-06' }, 0)).toEqual([
      '2026-01-09',
      '2026-01-23',
      '2026-02-06',
    ])
  })

  it('yearly: 2年ごとは開始日の年を1回目として発生する', () => {
    const rule = makeRule({
      frequency: 'yearly',
      monthOfYear: 6,
      dayOfMonth: 1,
      interval: 2,
      startsOn: '2026-01-01',
    })

    expect(enumerateDueDates(rule, { since: '2025-12-31', until: '2031-12-31' }, 0)).toEqual([
      '2026-06-01',
      '2028-06-01',
      '2030-06-01',
    ])
  })

  it('間隔が大きくても(10年ごと)次回発生日を見つけられる', () => {
    const rule = makeRule({
      frequency: 'yearly',
      monthOfYear: 6,
      dayOfMonth: 1,
      interval: 10,
      startsOn: '2026-01-01',
    })

    expect(nextOccurrenceDate(rule, '2026-06-01')).toBe('2036-06-01')
  })
})

describe('開始日・終了日(計画Issue #164)', () => {
  it('開始日より前の期日は列挙しない', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, startsOn: '2026-03-15' })

    expect(enumerateDueDates(rule, { since: '2026-01-01', until: '2026-05-31' }, 0)).toEqual([
      '2026-04-01',
      '2026-05-01',
    ])
  })

  it('終了日の当日が期日なら列挙し、翌日以降の期日は列挙しない', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, endsOn: '2026-03-01' })

    expect(enumerateDueDates(rule, { since: '2026-01-01', until: '2026-12-31' }, 0)).toEqual([
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('回数の上限と終了日の両方がある場合、先に来たほうで止まる(回数の上限が先)', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, endsOn: '2026-12-01', maxOccurrences: 2 })

    expect(enumerateDueDates(rule, { since: '2026-01-01', until: '2026-12-31' }, 0)).toEqual([
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('回数の上限と終了日の両方がある場合、先に来たほうで止まる(終了日が先)', () => {
    const rule = makeRule({ frequency: 'monthly', dayOfMonth: 1, endsOn: '2026-03-01', maxOccurrences: 10 })

    expect(enumerateDueDates(rule, { since: '2026-01-01', until: '2026-12-31' }, 0)).toEqual([
      '2026-02-01',
      '2026-03-01',
    ])
  })
})
