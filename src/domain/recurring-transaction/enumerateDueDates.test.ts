/**
 * nextOccurrenceDate(次回発生日の計算)・enumerateDueDates(前回チェック日〜現在の間に
 * 発生すべき対象日の列挙)の純粋関数としてのユニットテスト。
 * docs/domain/recurring-transactions.md 1.3の繰り返しルール(weekly/monthly(日付指定)/
 * monthly(曜日指定)/yearly)ごとの次回発生日計算、31日等その月に存在しない日付を指定した
 * 場合に月末へ丸める処理(#18コメントで確定した設計判断)、max_occurrencesに達した
 * ルールが以降の対象日を列挙しないことを検証する。DB非依存、外部依存なし。
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
