/**
 * 期間入力(日付/月の切替)の純粋関数 periodRangeModel のユニットテスト(計画Issue #314)。
 * 条件のモデルは dateFrom/dateTo のままで、月モードは「開始月の1日〜終了月の末日」への変換だけであること、
 * 日付→月へ切り替えると含まれる月に広がること、月の選択肢が仕訳のある月と選択中の月を含むことを検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildMonthOptions, isMonthAligned, monthOf, monthToDateRange, snapRangeToMonths } from './periodRangeModel'

describe('monthOf', () => {
  it('日付から、含まれる月(YYYY-MM)を返す', () => {
    expect(monthOf('2026-11-28')).toBe('2026-11')
  })

  it('日付が空なら空文字を返す', () => {
    expect(monthOf('')).toBe('')
  })
})

describe('monthToDateRange', () => {
  it('開始月は月初日、終了月は月末日にする', () => {
    expect(monthToDateRange('2026-10', '2026-11')).toEqual({ from: '2026-10-01', to: '2026-11-30' })
  })

  it('うるう年の2月の月末は29日になる', () => {
    expect(monthToDateRange('2028-02', '2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('「指定なし」(空文字)の側は、その側の日付を空にする', () => {
    expect(monthToDateRange('', '2026-11')).toEqual({ from: '', to: '2026-11-30' })
    expect(monthToDateRange('2026-10', '')).toEqual({ from: '2026-10-01', to: '' })
  })
})

describe('snapRangeToMonths', () => {
  it('日付の範囲を、含まれる月の月初〜月末に広げる(日付→月へ切り替えたとき)', () => {
    expect(snapRangeToMonths({ from: '2026-10-15', to: '2026-11-03' })).toEqual({ from: '2026-10-01', to: '2026-11-30' })
  })

  it('すでに月初〜月末なら変わらない(月→日→月と往復しても同じ)', () => {
    expect(snapRangeToMonths({ from: '2026-10-01', to: '2026-11-30' })).toEqual({ from: '2026-10-01', to: '2026-11-30' })
  })

  it('空の側は空のままにする', () => {
    expect(snapRangeToMonths({ from: '', to: '2026-11-03' })).toEqual({ from: '', to: '2026-11-30' })
  })
})

describe('buildMonthOptions', () => {
  it('仕訳の日付の最も古い月から新しい月まで、途切れなく新しい順に並べる', () => {
    expect(buildMonthOptions(['2026-09-20', '2026-11-03', '2026-09-01'], [])).toEqual(['2026-11', '2026-10', '2026-09'])
  })

  it('選択中の月が範囲の外にあっても、選択肢に含める(選択が消えないように)', () => {
    expect(buildMonthOptions(['2026-10-05'], ['2026-08', '2026-12'])).toEqual([
      '2026-12',
      '2026-11',
      '2026-10',
      '2026-09',
      '2026-08',
    ])
  })

  it('仕訳も選択も無いときは、空の配列を返す', () => {
    expect(buildMonthOptions([], [])).toEqual([])
  })
})

describe('isMonthAligned', () => {
  it('開始が月初・終了が月末(または指定なし)なら、月の指定として表せる', () => {
    expect(isMonthAligned({ from: '2026-10-01', to: '2026-11-30' })).toBe(true)
    expect(isMonthAligned({ from: '', to: '' })).toBe(true)
    expect(isMonthAligned({ from: '2026-10-01', to: '' })).toBe(true)
  })

  it('月の途中の日付が入っていたら、月の指定では表せない', () => {
    expect(isMonthAligned({ from: '2026-10-15', to: '2026-11-30' })).toBe(false)
    expect(isMonthAligned({ from: '2026-10-01', to: '2026-11-03' })).toBe(false)
  })
})
