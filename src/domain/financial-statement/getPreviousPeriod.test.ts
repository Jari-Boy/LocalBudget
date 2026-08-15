/**
 * getPreviousPeriod/getPreviousYearPeriodの純粋関数としてのユニットテスト。
 * PL(期間指定)の比較機能(docs/domain/financial-statements.md 2.2節「比較」)向けに、
 * 「前期」=同じ長さの直前期間(日数ベース、月次・年次・任意のカスタム範囲いずれにも
 * 機械的に定義できる)、「前年同期」=開始日・終了日をともに1年前にずらした期間、
 * という計画Issue #34の実装時判断を実現する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { getPreviousPeriod } from './getPreviousPeriod'
import { getPreviousYearPeriod } from './getPreviousYearPeriod'

describe('getPreviousPeriod', () => {
  it('月次の期間(31日間)なら、直前の同じ日数の期間を返す(暦月とは一致しない場合がある)', () => {
    // 7月は31日間のため、直前の31日間は6/1〜6/30ではなく5/31〜6/30になる
    expect(getPreviousPeriod({ from: '2026-07-01', to: '2026-07-31' })).toEqual({
      from: '2026-05-31',
      to: '2026-06-30',
    })
  })

  it('1日だけの期間なら、直前の1日を返す', () => {
    expect(getPreviousPeriod({ from: '2026-07-15', to: '2026-07-15' })).toEqual({
      from: '2026-07-14',
      to: '2026-07-14',
    })
  })

  it('任意のカスタム期間(7日間)でも同じ長さの直前期間を返す', () => {
    expect(getPreviousPeriod({ from: '2026-07-10', to: '2026-07-16' })).toEqual({
      from: '2026-07-03',
      to: '2026-07-09',
    })
  })
})

describe('getPreviousYearPeriod', () => {
  it('開始日・終了日をともに1年前にずらす', () => {
    expect(getPreviousYearPeriod({ from: '2026-07-01', to: '2026-07-31' })).toEqual({
      from: '2025-07-01',
      to: '2025-07-31',
    })
  })
})
