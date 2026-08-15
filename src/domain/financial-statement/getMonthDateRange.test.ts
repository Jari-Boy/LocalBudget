/**
 * getFirstDayOfMonth/getLastDayOfMonthの純粋関数としてのユニットテスト。
 * docs/domain/financial-statements.md 2.2節が求める「月次プリセット」実現のため、
 * 年+月(1-12)の組から、財務諸表の期間指定に使う'YYYY-MM-DD'形式の月初日・月末日
 * 文字列を導出する。うるう年2月・31日/30日の月末日の違いを中心に検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { getFirstDayOfMonth } from './getFirstDayOfMonth'
import { getLastDayOfMonth } from './getLastDayOfMonth'

describe('getFirstDayOfMonth', () => {
  it('年+月から月初日(YYYY-MM-01)を返す', () => {
    expect(getFirstDayOfMonth(2026, 7)).toBe('2026-07-01')
  })

  it('1桁の月も2桁でゼロパディングする', () => {
    expect(getFirstDayOfMonth(2026, 1)).toBe('2026-01-01')
  })
})

describe('getLastDayOfMonth', () => {
  it('31日まである月の月末日を返す', () => {
    expect(getLastDayOfMonth(2026, 7)).toBe('2026-07-31')
  })

  it('30日までの月の月末日を返す', () => {
    expect(getLastDayOfMonth(2026, 4)).toBe('2026-04-30')
  })

  it('平年2月の月末日は28日', () => {
    expect(getLastDayOfMonth(2026, 2)).toBe('2026-02-28')
  })

  it('うるう年2月の月末日は29日', () => {
    expect(getLastDayOfMonth(2028, 2)).toBe('2028-02-29')
  })

  it('12月の月末日を返す(年またぎの繰り上げが発生しない)', () => {
    expect(getLastDayOfMonth(2026, 12)).toBe('2026-12-31')
  })
})
