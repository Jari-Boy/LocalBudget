import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { colorForSeries } from './chartPalette'
import { barPath, layoutChart, PLOT, scaleY, tableRows, type ChartSeriesData, type ChartType } from './chartModel'
import './Chart.css'

export interface ChartProps {
  type: ChartType
  title: string
  categories: readonly string[]
  series: readonly ChartSeriesData[]
  /** 縦軸・ツールチップ・表に出す数値の整形(例: 金額) */
  formatValue: (value: number) => string
  /** SVGのaria-label。グラフの要点を文章で渡す */
  summary: string
  /** 渡すと、カテゴリのクリック・Enterでその内訳を下に固定表示する */
  renderDetail?: (categoryIndex: number) => ReactNode
}

/** 直接ラベル(線の端の系列名)を出す系列数の上限。これを超えると凡例だけにする。 */
const MAX_DIRECT_LABELS = 4

/**
 * SVGの自作グラフ(計画Issue #150)。縦棒・積み上げ・折れ線に対応し、縦軸は1本。
 * 2系列以上は凡例を出し、色だけに頼らないよう値は表(「数値を表で見る」)でも確認できる。
 * 各カテゴリの領域は、ホバー・フォーカスでツールチップ、クリック・Enterで内訳の固定表示、
 * ←→キーでカテゴリ間の移動ができる。グラフライブラリは使わない(ユーザー決定)。
 */
export function Chart({ type, title, categories, series, formatValue, summary, renderDetail }: ChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)

  const layout = layoutChart(type, categories.length, series)
  const rows = tableRows(categories, series, formatValue)
  const labelPoints = series.length <= MAX_DIRECT_LABELS

  const hitLabel = (categoryIndex: number) =>
    `${categories[categoryIndex]}: ${series
      .map((s) => {
        const value = s.values[categoryIndex] ?? null
        return `${s.name} ${value === null ? '-' : formatValue(value)}`
      })
      .join('、')}`

  const handleKeyDown = (event: KeyboardEvent<SVGRectElement>, categoryIndex: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const next = categoryIndex + (event.key === 'ArrowRight' ? 1 : -1)
      if (next < 0 || next >= categories.length) return
      event.currentTarget.parentElement?.querySelector<SVGRectElement>(`[data-hit="${next}"]`)?.focus()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      togglePinned(categoryIndex)
      return
    }
    if (event.key === 'Escape') setPinned(null)
  }

  const togglePinned = (categoryIndex: number) => {
    if (!renderDetail) return
    setPinned((current) => (current === categoryIndex ? null : categoryIndex))
  }

  const tipLeft = hovered === null ? 0 : ((layout.hits[hovered].x + layout.hits[hovered].width / 2) / PLOT.width) * 100

  return (
    <section className="chart" aria-label={title}>
      <div className="chart__head">
        <h2 className="chart__title">{title}</h2>
        {series.length >= 2 && (
          <ul className="chart__legend" aria-label="凡例">
            {series.map((s, index) => (
              <li key={s.key} className="chart__legend-item">
                <span aria-hidden="true" className="chart__swatch" style={{ background: colorForSeries(index) }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="chart__plot">
        <svg viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label={summary} className="chart__svg">
          {layout.scale.ticks.map((tick) => {
            const y = scaleY(tick, layout.scale)
            return (
              <g key={tick}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.right}
                  y1={y}
                  y2={y}
                  className={tick === 0 ? 'chart__baseline' : 'chart__grid'}
                />
                <text x={PLOT.left - 6} y={y + 4} data-axis="y" className="chart__axis-label chart__axis-label--y">
                  {formatValue(tick)}
                </text>
              </g>
            )
          })}

          {layout.bars.map((bar) => (
            <path
              key={`${bar.seriesIndex}-${bar.categoryIndex}`}
              d={barPath(bar)}
              fill={colorForSeries(bar.seriesIndex)}
              data-series={bar.seriesIndex}
              data-category={bar.categoryIndex}
            />
          ))}

          {layout.lines.map((line) => (
            <g key={line.seriesIndex}>
              {line.segments.map((segment, i) => (
                <polyline
                  key={i}
                  points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={colorForSeries(line.seriesIndex)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  data-series={line.seriesIndex}
                />
              ))}
              {line.points.map((p) => (
                <circle
                  key={p.categoryIndex}
                  cx={p.x}
                  cy={p.y}
                  r={hovered === p.categoryIndex ? 5 : 3}
                  fill={colorForSeries(line.seriesIndex)}
                  className="chart__dot"
                />
              ))}
              {labelPoints && line.points.length > 0 && (
                <text
                  x={line.points[line.points.length - 1].x}
                  y={line.points[line.points.length - 1].y - 10}
                  className="chart__end-label"
                >
                  {series[line.seriesIndex].name}
                </text>
              )}
            </g>
          ))}

          {categories.map((category, index) => (
            <text
              key={category}
              x={layout.hits[index].x + layout.hits[index].width / 2}
              y={PLOT.labelY}
              className="chart__axis-label chart__axis-label--x"
            >
              {category}
            </text>
          ))}

          {layout.hits.map((hit) => (
            <rect
              key={hit.categoryIndex}
              x={hit.x}
              y={hit.y}
              width={hit.width}
              height={hit.height}
              fill={hovered === hit.categoryIndex ? 'var(--color-text)' : 'transparent'}
              fillOpacity={hovered === hit.categoryIndex ? 0.05 : 0}
              className="chart__hit"
              role="button"
              tabIndex={0}
              aria-label={hitLabel(hit.categoryIndex)}
              aria-pressed={renderDetail ? pinned === hit.categoryIndex : undefined}
              data-hit={hit.categoryIndex}
              onMouseEnter={() => setHovered(hit.categoryIndex)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(hit.categoryIndex)}
              onBlur={() => setHovered(null)}
              onClick={() => togglePinned(hit.categoryIndex)}
              onKeyDown={(event) => handleKeyDown(event, hit.categoryIndex)}
            />
          ))}
        </svg>

        {hovered !== null && (
          <div role="tooltip" className="chart__tooltip" style={{ left: `${tipLeft}%` }}>
            <div className="chart__tooltip-title">{categories[hovered]}</div>
            {series.map((s, index) => {
              const value = s.values[hovered] ?? null
              return (
                <div key={s.key} className="chart__tooltip-row">
                  <span>
                    <span aria-hidden="true" className="chart__swatch" style={{ background: colorForSeries(index) }} />{' '}
                    {s.name}
                  </span>
                  <span className="chart__num">{value === null ? '-' : formatValue(value)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {renderDetail && pinned !== null && (
        <div role="region" aria-label={`${categories[pinned]}の内訳`} className="chart__detail">
          <div className="chart__detail-head">
            <span className="chart__detail-title">{categories[pinned]}</span>
            <button
              type="button"
              className="chart__close"
              aria-label="内訳を閉じる"
              onClick={() => setPinned(null)}
            >
              ×
            </button>
          </div>
          {renderDetail(pinned)}
        </div>
      )}

      <details className="chart__table">
        <summary>数値を表で見る</summary>
        <div className="chart__table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                {series.map((s) => (
                  <th key={s.key} className="chart__num">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.category}>
                  <th scope="row">{row.category}</th>
                  {row.cells.map((cell, i) => (
                    <td key={series[i].key} className="chart__num">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
