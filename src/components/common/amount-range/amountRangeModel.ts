/**
 * 金額の範囲スライダーの純粋関数(計画Issue #314)。目盛りは 0 / 1,000 / 1万 / 10万 / 100万 / 上限なし の非線形で、
 * 等間隔(20%)に並べる。最後の区間(80〜100%)は100万円から「スライダーが表す最大の金額」まで直線で補間し、
 * 右端(100%)は金額の上限を指定しない「上限なし」を表す。位置は0〜100(%)。DB・DOM非依存。
 */
export const AMOUNT_TICKS = [0, 1000, 10000, 100000, 1000000] as const

/** 目盛りの間隔(%)。目盛り5つ+最大で、区間は5つ */
const TICK_SPAN = 100 / AMOUNT_TICKS.length

/** 最大の金額の下限。100万円の目盛りの先に、最低限の余白(100万〜200万円)を残す */
const MIN_CAP = 2_000_000

/** スライダーが表す最大の金額。表示データの最大金額と200万円の大きいほう */
export function sliderCap(dataMax: number): number {
  return Math.max(dataMax, MIN_CAP)
}

/** 金額をスライダー上の位置(0〜100%)にする。目盛りの範囲を超える金額は右端(100%)に寄せる */
export function valueToPosition(value: number, cap: number): number {
  if (value <= 0) return 0
  const last = AMOUNT_TICKS.length - 1
  for (let index = 0; index < last; index++) {
    const from = AMOUNT_TICKS[index]
    const to = AMOUNT_TICKS[index + 1]
    if (value <= to) return index * TICK_SPAN + (TICK_SPAN * (value - from)) / (to - from)
  }
  const from = AMOUNT_TICKS[last]
  if (value >= cap) return 100
  return last * TICK_SPAN + (TICK_SPAN * (value - from)) / (cap - from)
}

/** 読みやすいよう、上位2桁に丸める(100円未満は円単位) */
function roundToTwoDigits(value: number): number {
  if (value < 100) return Math.round(value)
  const unit = 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.round(value / unit) * unit
}

/** スライダー上の位置(0〜100%)を金額にする。右端(100%)は最大の金額、目盛りの間は上位2桁に丸める */
export function positionToValue(position: number, cap: number): number {
  if (position <= 0) return 0
  if (position >= 100) return cap
  const last = AMOUNT_TICKS.length - 1
  const index = Math.min(Math.floor(position / TICK_SPAN), last)
  const from = AMOUNT_TICKS[index]
  const to = index === last ? cap : AMOUNT_TICKS[index + 1]
  return roundToTwoDigits(from + ((position - index * TICK_SPAN) / TICK_SPAN) * (to - from))
}

/** 2つの摘みの位置から、金額の範囲にする。下限が左端なら下限なし、上限が右端なら上限なし(null) */
export function thumbsToRange(
  minPosition: number,
  maxPosition: number,
  cap: number,
): { min: number | null; max: number | null } {
  return {
    min: minPosition <= 0 ? null : positionToValue(minPosition, cap),
    max: maxPosition >= 100 ? null : positionToValue(maxPosition, cap),
  }
}

/** 金額の範囲から、2つの摘みの位置にする。下限なしは左端、上限なしは右端。目盛りの範囲外の金額は端に寄せる */
export function rangeToThumbs(
  min: number | null,
  max: number | null,
  cap: number,
): { minPosition: number; maxPosition: number } {
  return {
    minPosition: min === null ? 0 : valueToPosition(min, cap),
    maxPosition: max === null ? 100 : valueToPosition(max, cap),
  }
}

/** キーボード操作で動かした後の位置。矢印キーは1%、PageUp/PageDownは10%、Home/Endは両端。対応しないキーはnull */
export function stepPosition(position: number, key: string): number | null {
  const clamp = (value: number) => Math.min(100, Math.max(0, value))
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(position + 1)
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(position - 1)
    case 'PageUp':
      return clamp(position + 10)
    case 'PageDown':
      return clamp(position - 10)
    case 'Home':
      return 0
    case 'End':
      return 100
    default:
      return null
  }
}
