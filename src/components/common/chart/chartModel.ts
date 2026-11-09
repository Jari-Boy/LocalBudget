/**
 * グラフの目盛り・配置を計算する純粋関数(計画Issue #150)。縦棒・積み上げ・折れ線で共通の
 * プロット領域(PLOT)に、縦軸1本の目盛りと各マークの座標を求める。DOM・DB非依存。
 */
export interface ChartSeriesData {
  key: string
  name: string
  /** カテゴリごとの値。値がないカテゴリはnull */
  values: readonly (number | null)[]
  /** 系列の色。省略時は系列の並びに固定の色(「その他」を固定色にするときに指定する) */
  color?: string
}

export type ChartType = 'bar' | 'stacked' | 'line'

/** SVGのviewBoxとプロット領域(軸の数値は左、カテゴリのラベルは下)。モックアップと同じ寸法。 */
export const PLOT = {
  width: 640,
  height: 236,
  left: 48,
  right: 632,
  top: 12,
  bottom: 208,
  labelY: 228,
} as const

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** 0を含む、きりのよい刻み(1・2・5×10の累乗)の縦軸の目盛りを返す。 */
export function niceScale(minValue: number, maxValue: number, tickCount = 4): Scale {
  const lo = Math.min(0, minValue)
  const hi = Math.max(0, maxValue)
  if (lo === 0 && hi === 0) return { min: 0, max: 1, ticks: [0, 1] }
  const rawStep = (hi - lo) / tickCount
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let value = min; value <= max + step / 1000; value += step) {
    ticks.push(Math.round(value / step) * step)
  }
  return { min, max, ticks }
}

export function scaleY(value: number, scale: Scale): number {
  return PLOT.bottom - ((value - scale.min) / (scale.max - scale.min)) * (PLOT.bottom - PLOT.top)
}

export interface BarMark {
  seriesIndex: number
  categoryIndex: number
  x: number
  y: number
  width: number
  height: number
  negative: boolean
  /** データ側の端を丸めるか(積み上げでは各カテゴリの一番外側の棒だけ) */
  rounded: boolean
}

export interface LinePoint {
  categoryIndex: number
  x: number
  y: number
  value: number
}

export interface LineMark {
  seriesIndex: number
  points: LinePoint[]
  /** nullで途切れた、連続した区間ごとの点 */
  segments: LinePoint[][]
}

export interface HitArea {
  categoryIndex: number
  x: number
  y: number
  width: number
  height: number
}

export interface ChartLayout {
  scale: Scale
  bars: BarMark[]
  lines: LineMark[]
  hits: HitArea[]
}

/** 積み上げの棒どうし・隣り合う塗りの間の隙間(px) */
const STACK_GAP = 2
const MAX_BAR_WIDTH = 32
const MAX_GROUPED_BAR_WIDTH = 24
const GROUP_GAP = 2

export function layoutChart(
  type: ChartType,
  categoryCount: number,
  series: readonly ChartSeriesData[],
): ChartLayout {
  const band = (PLOT.right - PLOT.left) / categoryCount
  const centerOf = (categoryIndex: number) => PLOT.left + band * (categoryIndex + 0.5)

  const valueAt = (s: ChartSeriesData, i: number) => s.values[i] ?? null

  const range = (): [number, number] => {
    if (type === 'stacked') {
      let min = 0
      let max = 0
      for (let i = 0; i < categoryCount; i++) {
        const positive = series.reduce((sum, s) => sum + Math.max(valueAt(s, i) ?? 0, 0), 0)
        const negative = series.reduce((sum, s) => sum + Math.min(valueAt(s, i) ?? 0, 0), 0)
        max = Math.max(max, positive)
        min = Math.min(min, negative)
      }
      return [min, max]
    }
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
    return [Math.min(0, ...all), Math.max(0, ...all)]
  }

  const [min, max] = range()
  const scale = niceScale(min, max)
  const zeroY = scaleY(0, scale)

  const bars: BarMark[] = []
  const lines: LineMark[] = []

  if (type === 'bar') {
    const groupWidth = band * 0.7
    const barWidth = Math.min(MAX_GROUPED_BAR_WIDTH, (groupWidth - GROUP_GAP * (series.length - 1)) / series.length)
    const totalWidth = barWidth * series.length + GROUP_GAP * (series.length - 1)
    series.forEach((s, seriesIndex) => {
      for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex++) {
        const value = valueAt(s, categoryIndex)
        if (value === null) continue
        const valueY = scaleY(value, scale)
        bars.push({
          seriesIndex,
          categoryIndex,
          x: centerOf(categoryIndex) - totalWidth / 2 + seriesIndex * (barWidth + GROUP_GAP),
          y: Math.min(valueY, zeroY),
          width: barWidth,
          height: Math.abs(zeroY - valueY),
          negative: value < 0,
          rounded: true,
        })
      }
    })
  } else if (type === 'stacked') {
    const barWidth = Math.min(MAX_BAR_WIDTH, band * 0.6)
    for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex++) {
      let positiveTop = 0
      let negativeBottom = 0
      const categoryBars: BarMark[] = []
      series.forEach((s, seriesIndex) => {
        const value = valueAt(s, categoryIndex)
        if (value === null || value === 0) return
        const from = value > 0 ? positiveTop : negativeBottom
        const to = from + value
        if (value > 0) positiveTop = to
        else negativeBottom = to
        const fromY = scaleY(from, scale)
        const toY = scaleY(to, scale)
        const height = Math.abs(fromY - toY)
        const gap = from === 0 ? 0 : Math.min(STACK_GAP, Math.max(height - 1, 0))
        categoryBars.push({
          seriesIndex,
          categoryIndex,
          x: centerOf(categoryIndex) - barWidth / 2,
          // 手前の塗りとの間にSTACK_GAPをあける(基準線に接する最初の棒は詰めない)
          y: value > 0 ? toY : fromY + gap,
          width: barWidth,
          height: height - gap,
          negative: value < 0,
          rounded: false,
        })
      })
      // 正負それぞれで、最後に積んだ(一番外側の)棒だけを丸める
      const lastPositive = [...categoryBars].reverse().find((b) => !b.negative)
      const lastNegative = [...categoryBars].reverse().find((b) => b.negative)
      if (lastPositive) lastPositive.rounded = true
      if (lastNegative) lastNegative.rounded = true
      bars.push(...categoryBars)
    }
  } else {
    series.forEach((s, seriesIndex) => {
      const points: LinePoint[] = []
      const segments: LinePoint[][] = []
      let current: LinePoint[] = []
      for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex++) {
        const value = valueAt(s, categoryIndex)
        if (value === null) {
          if (current.length > 0) segments.push(current)
          current = []
          continue
        }
        const point = { categoryIndex, x: centerOf(categoryIndex), y: scaleY(value, scale), value }
        points.push(point)
        current.push(point)
      }
      if (current.length > 0) segments.push(current)
      lines.push({ seriesIndex, points, segments })
    })
  }

  const hits: HitArea[] = Array.from({ length: categoryCount }, (_, categoryIndex) => ({
    categoryIndex,
    x: PLOT.left + band * categoryIndex,
    y: PLOT.top,
    width: band,
    height: PLOT.bottom - PLOT.top,
  }))

  return { scale, bars, lines, hits }
}

export interface BarShape {
  x: number
  y: number
  width: number
  height: number
  negative: boolean
  rounded: boolean
}

const CORNER = 4

/**
 * 棒のSVGパス。基準線側は角のまま、データ側の端だけを4px(高さ・幅が足りなければその分)丸める。
 * 正の棒は上端、負の棒は下端がデータ側。
 */
export function barPath({ x, y, width, height, negative, rounded }: BarShape): string {
  const right = x + width
  const bottom = y + height
  if (!rounded) return `M ${x} ${y} L ${right} ${y} L ${right} ${bottom} L ${x} ${bottom} Z`
  const r = Math.min(CORNER, width / 2, height)
  if (!negative) {
    return `M ${x} ${bottom} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${right - r} ${y} Q ${right} ${y} ${right} ${y + r} L ${right} ${bottom} Z`
  }
  return `M ${x} ${y} L ${x} ${bottom - r} Q ${x} ${bottom} ${x + r} ${bottom} L ${right - r} ${bottom} Q ${right} ${bottom} ${right} ${bottom - r} L ${right} ${y} Z`
}

export interface TableRow {
  category: string
  cells: string[]
}

/** グラフと同じ数値を表で確認するための行(値がないセルは「-」)。 */
export function tableRows(
  categories: readonly string[],
  series: readonly ChartSeriesData[],
  formatValue: (value: number) => string,
): TableRow[] {
  return categories.map((category, i) => ({
    category,
    cells: series.map((s) => {
      const value = s.values[i] ?? null
      return value === null ? '-' : formatValue(value)
    }),
  }))
}

/** 横軸のラベルを間引かずに出せるカテゴリ数の上限(超えたら末尾から1つおきに出す) */
const MAX_ALL_LABELS = 12

/** 横軸にラベルを出すカテゴリの番号。13個以上は、重ならないよう末尾から1つおきにする。 */
export function visibleLabelIndexes(categoryCount: number): number[] {
  const all = Array.from({ length: categoryCount }, (_, i) => i)
  if (categoryCount <= MAX_ALL_LABELS) return all
  return all.filter((i) => i % 2 === (categoryCount - 1) % 2)
}

/**
 * 選択した範囲(カテゴリの番号、両端を含む)を示す帯のx座標と幅。
 * すべてのカテゴリを覆うときは帯を出さないためnullを返す。
 */
export function selectionBand(categoryCount: number, start: number, end: number): { x: number; width: number } | null {
  const first = Math.max(start, 0)
  const last = Math.min(end, categoryCount - 1)
  if (first <= 0 && last >= categoryCount - 1) return null
  const band = (PLOT.right - PLOT.left) / categoryCount
  return { x: PLOT.left + band * first, width: band * (last - first + 1) }
}
