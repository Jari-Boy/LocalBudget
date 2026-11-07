/**
 * グラフの系列色(chartPalette)のテスト(計画Issue #150)。
 * 完了条件「色の組み合わせがグラフ用の検証を通っている」のため、dataviz スキルの
 * 検証スクリプト(validate_palette.js、--mode light --surface #FFFFFF)を通した値をここで固定し、
 * 色の変更が検証なしに入らないようにする。検証結果はファイル先頭のコメントと docs/decisions.md に記録する。
 * 系列は固定の順序で割り当て(循環させない)、6系列目以降は生成した色ではなく「その他」の灰色にまとめる。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { CHART_OTHER_COLOR, CHART_SERIES_COLORS, colorForSeries } from './chartPalette'

describe('chartPalette', () => {
  it('検証済みの5色を、モックアップと同じ固定の順序で持つ', () => {
    expect(CHART_SERIES_COLORS).toEqual(['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4'])
    expect(CHART_OTHER_COLOR).toBe('#898781')
  })

  it('すべて6桁の16進数で、互いに重複しない', () => {
    const all = [...CHART_SERIES_COLORS, CHART_OTHER_COLOR]
    for (const color of all) expect(color).toMatch(/^#[0-9A-F]{6}$/)
    expect(new Set(all).size).toBe(all.length)
  })

  it('系列の順番どおりに色を割り当て、5系列を超える分は「その他」の色にする', () => {
    expect([0, 1, 2, 3, 4].map(colorForSeries)).toEqual([...CHART_SERIES_COLORS])
    expect(colorForSeries(5)).toBe(CHART_OTHER_COLOR)
    expect(colorForSeries(12)).toBe(CHART_OTHER_COLOR)
  })
})
