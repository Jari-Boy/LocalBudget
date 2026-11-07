import { colorForSeries } from './chartPalette'
import './Chart.css'

export interface HorizontalBarItem {
  key: string
  name: string
  value: number
}

export interface HorizontalBarChartProps {
  title: string
  items: readonly HorizontalBarItem[]
  formatValue: (value: number) => string
  /** 行を押したときに項目のkeyを通知する(内訳の表示などに使う) */
  onSelect?: (key: string) => void
}

/**
 * 横棒グラフ(計画Issue #150)。費用の内訳のように、項目ごとの大きさと構成比を比べる。
 * 1項目1行で「名称・棒・金額・構成比」を並べ、棒の長さは最大値に対する割合にする。
 * 系列は1つなので凡例は出さず、見出しが対象を示す。数値は行の文字として常に見える。
 */
export function HorizontalBarChart({ title, items, formatValue, onSelect }: HorizontalBarChartProps) {
  const max = Math.max(0, ...items.map((item) => item.value))
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return (
    <section className="chart" aria-label={title}>
      <div className="chart__head">
        <h2 className="chart__title">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="chart__empty">データがありません</p>
      ) : (
        <div className="chart__hbars">
          {items.map((item) => {
            const share = total > 0 ? Math.round((item.value / total) * 100) : 0
            return (
              <button
                key={item.key}
                type="button"
                className="chart__hbar-row"
                aria-label={`${item.name}: ${formatValue(item.value)}(${share}%)`}
                onClick={() => onSelect?.(item.key)}
              >
                <span>{item.name}</span>
                <span className="chart__hbar-track">
                  <span
                    data-bar
                    className="chart__hbar"
                    style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%`, background: colorForSeries(0) }}
                  />
                </span>
                <span className="chart__num">{formatValue(item.value)}</span>
                <span className="chart__num chart__share">{share}%</span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
