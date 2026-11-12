/**
 * adjustForWeekend(土日の調整、計画Issue #164)の純粋関数としてのユニットテスト。
 * 期日が土曜・日曜のとき、none(そのまま)・next(翌平日=月曜へ)・previous(前平日=金曜へ)で
 * 調整後の日付を返すこと、平日は調整しないこと、祝日は考慮しないこと、月・年をまたぐことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { adjustForWeekend } from './adjustForWeekend'

describe('adjustForWeekend', () => {
  it('none: 土曜日でも日曜日でもそのままの日付を返す', () => {
    expect(adjustForWeekend('2026-01-24', 'none')).toBe('2026-01-24')
    expect(adjustForWeekend('2026-01-25', 'none')).toBe('2026-01-25')
  })

  it('next: 土曜日は翌々日の月曜日、日曜日は翌日の月曜日にずらす', () => {
    expect(adjustForWeekend('2026-01-24', 'next')).toBe('2026-01-26')
    expect(adjustForWeekend('2026-01-25', 'next')).toBe('2026-01-26')
  })

  it('previous: 土曜日は前日の金曜日、日曜日は前々日の金曜日にずらす', () => {
    expect(adjustForWeekend('2026-01-24', 'previous')).toBe('2026-01-23')
    expect(adjustForWeekend('2026-01-25', 'previous')).toBe('2026-01-23')
  })

  it('next・previous: 平日はそのままの日付を返す', () => {
    expect(adjustForWeekend('2026-01-23', 'next')).toBe('2026-01-23')
    expect(adjustForWeekend('2026-01-26', 'previous')).toBe('2026-01-26')
  })

  it('next: 月末の土曜日は翌月の月曜日にずらす(月をまたぐ)', () => {
    expect(adjustForWeekend('2026-05-30', 'next')).toBe('2026-06-01')
  })

  it('previous: 月初の日曜日は前月の金曜日にずらす(月をまたぐ)', () => {
    expect(adjustForWeekend('2026-02-01', 'previous')).toBe('2026-01-30')
  })

  it('祝日は考慮しない(2026-01-12は成人の日だが月曜日なのでそのまま)', () => {
    expect(adjustForWeekend('2026-01-12', 'next')).toBe('2026-01-12')
  })
})
