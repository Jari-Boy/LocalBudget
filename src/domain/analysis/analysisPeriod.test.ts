/**
 * 分析画面(計画Issue #155)の期間まわりの純粋関数のユニットテスト。
 * 期間プリセット(今月・直近3か月・今年・直近12か月・昨年)の解決、期間に含まれる月の列挙、
 * 推移グラフの表示範囲(期間が12か月未満でも直近12か月を出す)、比較期間(前期・前年同期)を検証する。
 * 前期・前年同期は既存の財務諸表の機能(getPreviousPeriod・getPreviousYearPeriod)を維持する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  listMonthsOfPeriod,
  resolveComparisonPeriod,
  resolvePresetPeriod,
  resolveTrendWindowMonths,
} from './analysisPeriod'

const TODAY = '2026-11-09'

describe('resolvePresetPeriod', () => {
  it('今月は、今日を含む月の月初から月末まで', () => {
    expect(resolvePresetPeriod('thisMonth', TODAY)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('直近3か月は、今月を含む3か月分(月初から今月末)', () => {
    expect(resolvePresetPeriod('last3Months', TODAY)).toEqual({ from: '2026-09-01', to: '2026-11-30' })
  })

  it('今年は、今年の1月から今月末まで', () => {
    expect(resolvePresetPeriod('thisYear', TODAY)).toEqual({ from: '2026-01-01', to: '2026-11-30' })
  })

  it('直近12か月は、今月を含む12か月分(年をまたぐ)', () => {
    expect(resolvePresetPeriod('last12Months', TODAY)).toEqual({ from: '2025-12-01', to: '2026-11-30' })
  })

  it('昨年は、昨年の1月1日から12月31日まで', () => {
    expect(resolvePresetPeriod('lastYear', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('うるう年の2月末を月末として解決する', () => {
    expect(resolvePresetPeriod('thisMonth', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('listMonthsOfPeriod', () => {
  it('期間の開始日と終了日を含む月を、古い順に列挙する', () => {
    expect(listMonthsOfPeriod({ from: '2026-09-15', to: '2026-11-02' })).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('同じ月の中の期間なら、その月だけを返す', () => {
    expect(listMonthsOfPeriod({ from: '2026-07-10', to: '2026-07-16' })).toEqual(['2026-07'])
  })

  it('年をまたぐ期間でも月を連続して列挙する', () => {
    expect(listMonthsOfPeriod({ from: '2025-11-01', to: '2026-02-28' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
  })
})

describe('resolveTrendWindowMonths', () => {
  it('期間が12か月未満でも、終了月を末尾にした直近12か月を返す', () => {
    const months = resolveTrendWindowMonths({ from: '2026-11-01', to: '2026-11-30' })
    expect(months).toHaveLength(12)
    expect(months[0]).toBe('2025-12')
    expect(months[11]).toBe('2026-11')
  })

  it('期間が12か月を超えるときは、期間の開始月から終了月までをすべて返す', () => {
    const months = resolveTrendWindowMonths({ from: '2025-01-01', to: '2026-11-30' })
    expect(months).toHaveLength(23)
    expect(months[0]).toBe('2025-01')
    expect(months[22]).toBe('2026-11')
  })
})

describe('resolveComparisonPeriod', () => {
  const period = { from: '2026-07-01', to: '2026-07-31' }

  it('比較なしならnull', () => {
    expect(resolveComparisonPeriod(period, 'none')).toBeNull()
  })

  it('前期は、同じ日数の直前の期間', () => {
    expect(resolveComparisonPeriod(period, 'previousPeriod')).toEqual({ from: '2026-05-31', to: '2026-06-30' })
  })

  it('前年同期は、開始日・終了日を1年前にずらした期間', () => {
    expect(resolveComparisonPeriod(period, 'previousYear')).toEqual({ from: '2025-07-01', to: '2025-07-31' })
  })
})
