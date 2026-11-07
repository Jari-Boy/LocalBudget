/**
 * グラフの目盛り・配置を計算する純粋関数(chartModel)のテスト(計画Issue #150)。
 * 縦軸は1本で0を含む「きりのよい」目盛り、縦棒・積み上げ・折れ線の座標、データ側の端だけを
 * 4px丸めた棒のパス、積み上げの2pxの隙間、ホバー・フォーカス用の当たり判定、数値の表を検証する。
 * 外部依存なし(DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import {
  barPath,
  layoutChart,
  niceScale,
  PLOT,
  scaleY,
  tableRows,
  type ChartSeriesData,
} from './chartModel'

describe('niceScale', () => {
  it('0を含み、きりのよい刻み(1・2・5×10の累乗)の目盛りを返す', () => {
    expect(niceScale(0, 1234)).toEqual({ min: 0, max: 1500, ticks: [0, 500, 1000, 1500] })
    expect(niceScale(0, 80)).toEqual({ min: 0, max: 80, ticks: [0, 20, 40, 60, 80] })
  })

  it('負の値があるときは0をまたぐ目盛りを返す', () => {
    const scale = niceScale(-300, 800)
    expect(scale.min).toBeLessThanOrEqual(-300)
    expect(scale.max).toBeGreaterThanOrEqual(800)
    expect(scale.ticks).toContain(0)
  })

  it('すべて0のときも0を含む目盛りを返す', () => {
    const scale = niceScale(0, 0)
    expect(scale.ticks).toContain(0)
    expect(scale.max).toBeGreaterThan(0)
  })
})

describe('scaleY', () => {
  it('最小値を下端、最大値を上端に写す', () => {
    const scale = { min: 0, max: 100, ticks: [0, 100] }
    expect(scaleY(0, scale)).toBe(PLOT.bottom)
    expect(scaleY(100, scale)).toBe(PLOT.top)
    expect(scaleY(50, scale)).toBe((PLOT.top + PLOT.bottom) / 2)
  })
})

const series: ChartSeriesData[] = [
  { key: 'rev', name: '収益', values: [100, 200, 300] },
  { key: 'exp', name: '費用', values: [50, 150, 250] },
]

describe('layoutChart(棒)', () => {
  it('系列×カテゴリの数だけ棒を並べ、同じカテゴリの棒は帯の中に収まる', () => {
    const layout = layoutChart('bar', 3, series)
    expect(layout.bars).toHaveLength(6)
    const band = (PLOT.right - PLOT.left) / 3
    for (const bar of layout.bars) {
      const bandStart = PLOT.left + band * bar.categoryIndex
      expect(bar.x).toBeGreaterThanOrEqual(bandStart)
      expect(bar.x + bar.width).toBeLessThanOrEqual(bandStart + band)
    }
  })

  it('値が大きい棒ほど高く、棒の下端は基準線(0)に揃う', () => {
    const layout = layoutChart('bar', 3, series)
    const small = layout.bars.find((b) => b.seriesIndex === 0 && b.categoryIndex === 0)!
    const large = layout.bars.find((b) => b.seriesIndex === 0 && b.categoryIndex === 2)!
    expect(large.height).toBeGreaterThan(small.height)
    expect(small.y + small.height).toBeCloseTo(scaleY(0, layout.scale))
  })

  it('負の値の棒は基準線から下へ伸びる', () => {
    const layout = layoutChart('bar', 1, [{ key: 'a', name: 'a', values: [-100] }])
    const bar = layout.bars[0]
    expect(bar.negative).toBe(true)
    expect(bar.y).toBeCloseTo(scaleY(0, layout.scale))
  })

  it('値がnullのカテゴリには棒を作らない', () => {
    const layout = layoutChart('bar', 2, [{ key: 'a', name: 'a', values: [10, null] }])
    expect(layout.bars).toHaveLength(1)
  })

  it('カテゴリごとに、プロット全体の高さを持つ当たり判定を1つずつ作る', () => {
    const layout = layoutChart('bar', 3, series)
    expect(layout.hits).toHaveLength(3)
    expect(layout.hits[0]).toMatchObject({ categoryIndex: 0, y: PLOT.top, height: PLOT.bottom - PLOT.top })
    expect(layout.hits[1].x).toBeCloseTo(layout.hits[0].x + layout.hits[0].width)
  })
})

describe('layoutChart(積み上げ)', () => {
  it('同じカテゴリの棒を下から積み、系列間に2pxの隙間をあける', () => {
    const layout = layoutChart('stacked', 1, series)
    const [first, second] = layout.bars
    expect(first.x).toBe(second.x)
    // 後の系列は前の系列の上端より上にあり、その間が2px以上あく
    expect(first.y - (second.y + second.height)).toBeGreaterThanOrEqual(2)
  })

  it('スケールは積み上げた合計に合わせる', () => {
    const layout = layoutChart('stacked', 1, series)
    expect(layout.scale.max).toBeGreaterThanOrEqual(150)
  })

  it('丸めるのは各カテゴリの一番外側の棒だけ(内側の棒は角を丸めない)', () => {
    const layout = layoutChart('stacked', 1, series)
    expect(layout.bars.filter((b) => b.rounded)).toHaveLength(1)
    expect(layout.bars[1].rounded).toBe(true)
  })
})

describe('layoutChart(折れ線)', () => {
  it('系列ごとに、カテゴリの中央に点を並べる', () => {
    const layout = layoutChart('line', 3, series)
    expect(layout.lines).toHaveLength(2)
    const band = (PLOT.right - PLOT.left) / 3
    expect(layout.lines[0].points.map((p) => p.x)).toEqual([
      PLOT.left + band * 0.5,
      PLOT.left + band * 1.5,
      PLOT.left + band * 2.5,
    ])
  })

  it('nullの点で線を途切れさせ、連続した区間(segments)に分ける', () => {
    const layout = layoutChart('line', 4, [{ key: 'a', name: 'a', values: [1, 2, null, 4] }])
    expect(layout.lines[0].segments.map((s) => s.length)).toEqual([2, 1])
  })
})

describe('barPath', () => {
  it('正の棒は上端(データ側)だけを4px丸め、下端(基準線側)は角のままにする', () => {
    const d = barPath({ x: 10, y: 20, width: 30, height: 50, negative: false, rounded: true })
    expect(d).toContain('Q 10 20 14 20')
    expect(d.startsWith('M 10 70')).toBe(true)
  })

  it('負の棒は下端だけを丸める', () => {
    const d = barPath({ x: 10, y: 20, width: 30, height: 50, negative: true, rounded: true })
    expect(d).toContain('Q 10 70 14 70')
  })

  it('丸めない棒は長方形のパス、高さが4pxに満たない棒は半径を高さに合わせる', () => {
    expect(barPath({ x: 0, y: 0, width: 10, height: 10, negative: false, rounded: false })).not.toContain('Q')
    expect(barPath({ x: 0, y: 0, width: 10, height: 2, negative: false, rounded: true })).toContain('Q 0 0 2 0')
  })
})

describe('tableRows', () => {
  it('カテゴリごとに、系列の値を整形した表の行を返す(nullは「-」)', () => {
    const rows = tableRows(['1月', '2月'], [{ key: 'a', name: 'A', values: [1000, null] }], (n) => `${n}円`)
    expect(rows).toEqual([
      { category: '1月', cells: ['1000円'] },
      { category: '2月', cells: ['-'] },
    ])
  })
})
