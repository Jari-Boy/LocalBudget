/**
 * 金額の範囲スライダーの純粋関数 amountRangeModel のユニットテスト(計画Issue #314)。
 * 目盛りは 0 / 1,000 / 1万 / 10万 / 100万 / 上限なし の非線形(等間隔20%)で、上限は表示データの最大値から決まり、
 * 右端は「上限なし」(金額の上限を指定しない)になること、目盛りの範囲外の入力値はスライダーの端に寄せて表示するが
 * 値そのものは変えないこと、キーボード操作の刻みを検証する。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  AMOUNT_TICKS,
  positionToValue,
  rangeToThumbs,
  sliderCap,
  stepPosition,
  thumbsToRange,
  valueToPosition,
} from './amountRangeModel'

describe('sliderCap(スライダーが表す最大の金額)', () => {
  it('表示データの最大金額が200万円以下なら、200万円にする(100万円の目盛りの先に余白を残す)', () => {
    expect(sliderCap(0)).toBe(2_000_000)
    expect(sliderCap(1_500_000)).toBe(2_000_000)
  })

  it('表示データの最大金額が200万円を超えるなら、その金額にする', () => {
    expect(sliderCap(8_400_000)).toBe(8_400_000)
  })
})

describe('valueToPosition / positionToValue(非線形の目盛り)', () => {
  const cap = 2_000_000

  it('目盛りの値は、等間隔(0・20・40・60・80%)の位置に対応する', () => {
    expect(AMOUNT_TICKS).toEqual([0, 1000, 10000, 100000, 1000000])
    expect(AMOUNT_TICKS.map((tick) => valueToPosition(tick, cap))).toEqual([0, 20, 40, 60, 80])
  })

  it('目盛りの間は直線で補間する(5,500円は1,000円と1万円の中間の30%)', () => {
    expect(valueToPosition(5500, cap)).toBeCloseTo(30)
  })

  it('100万円より先は、100万円(80%)から最大(100%)まで直線で補間する', () => {
    expect(valueToPosition(1_500_000, cap)).toBeCloseTo(90)
    expect(valueToPosition(cap, cap)).toBe(100)
  })

  it('目盛りの範囲を超える値は、端(100%)に寄せる', () => {
    expect(valueToPosition(99_999_999, cap)).toBe(100)
  })

  it('位置から金額に戻すと、目盛りの位置では目盛りの値になる', () => {
    expect([0, 20, 40, 60, 80].map((position) => positionToValue(position, cap))).toEqual(AMOUNT_TICKS)
  })

  it('目盛りの間の金額は、読みやすいよう上位2桁に丸める', () => {
    // 30%は5,500円。上位2桁に丸めても5,500円
    expect(positionToValue(30, cap)).toBe(5500)
    // 25%は3,250円 → 上位2桁で3,300円(切り上がるのは四捨五入のため)
    expect(positionToValue(25, cap)).toBe(3300)
  })
})

describe('thumbsToRange / rangeToThumbs(摘みの位置と金額の範囲の相互変換)', () => {
  const cap = 2_000_000

  it('下限の摘みが左端(0%)なら下限なし、上限の摘みが右端(100%)なら上限なし(上限なし)', () => {
    expect(thumbsToRange(0, 100, cap)).toEqual({ min: null, max: null })
  })

  it('摘みが途中にあれば、その位置の金額を下限・上限にする', () => {
    expect(thumbsToRange(20, 60, cap)).toEqual({ min: 1000, max: 100000 })
  })

  it('範囲の金額から摘みの位置を求める。指定なしは、下限は左端・上限は右端', () => {
    expect(rangeToThumbs(null, null, cap)).toEqual({ minPosition: 0, maxPosition: 100 })
    expect(rangeToThumbs(1000, 100000, cap)).toEqual({ minPosition: 20, maxPosition: 60 })
  })

  it('目盛りの範囲外の入力値(上限が最大より大きい)は、摘みを右端に寄せる', () => {
    expect(rangeToThumbs(null, 99_999_999, cap).maxPosition).toBe(100)
  })
})

describe('stepPosition(キーボード操作)', () => {
  it('矢印キーは1%、PageUp/PageDownは10%動かし、0〜100%に収める', () => {
    expect(stepPosition(50, 'ArrowRight')).toBe(51)
    expect(stepPosition(50, 'ArrowUp')).toBe(51)
    expect(stepPosition(50, 'ArrowLeft')).toBe(49)
    expect(stepPosition(50, 'ArrowDown')).toBe(49)
    expect(stepPosition(50, 'PageUp')).toBe(60)
    expect(stepPosition(50, 'PageDown')).toBe(40)
    expect(stepPosition(99.5, 'PageUp')).toBe(100)
    expect(stepPosition(0.5, 'ArrowLeft')).toBe(0)
  })

  it('Homeは0%、Endは100%にする。対応しないキーはnull', () => {
    expect(stepPosition(50, 'Home')).toBe(0)
    expect(stepPosition(50, 'End')).toBe(100)
    expect(stepPosition(50, 'a')).toBeNull()
  })
})
