// @vitest-environment jsdom
/**
 * グラフ(Chart・HorizontalBarChart)のコンポーネントテスト(計画Issue #150)。
 * SVGの自作で、縦棒・積み上げ・折れ線・横棒を描く。縦軸は1本、2系列以上は凡例を出す。
 * ホバーとフォーカスでツールチップ、クリックで内訳を固定表示、←→キーでカテゴリ間を移動でき、
 * 同じ数値を表でも確認できることを検証する(色の検証は chartPalette.test.ts)。
 * 外部依存なし(グラフライブラリは使わない)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Chart, type ChartProps } from './Chart'
import { HorizontalBarChart } from './HorizontalBarChart'

afterEach(cleanup)

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`

const baseProps: ChartProps = {
  type: 'bar',
  title: '月別の収支',
  categories: ['10月', '11月', '12月'],
  series: [
    { key: 'rev', name: '収益', values: [300000, 320000, 310000] },
    { key: 'exp', name: '費用', values: [250000, 280000, 400000] },
  ],
  formatValue: yen,
  summary: '10月から12月の収益と費用の月別の推移',
}

const hitOf = (name: RegExp | string) => screen.getByRole('button', { name })

describe('Chart(表示)', () => {
  it('見出しと、要約をaria-labelに持つSVGを表示する', () => {
    render(<Chart {...baseProps} />)
    expect(screen.getByRole('heading', { name: '月別の収支' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: baseProps.summary })).toBeInTheDocument()
  })

  it('縦軸は1本で、0を含む目盛りの数値を整形して表示し、横軸にカテゴリを表示する', () => {
    render(<Chart {...baseProps} />)
    const svg = screen.getByRole('img', { name: baseProps.summary })
    expect(svg).toHaveTextContent('0円')
    expect(svg).toHaveTextContent('10月')
    expect(svg).toHaveTextContent('12月')
    // 縦軸の目盛りのテキストはすべて同じ列(同じx座標)に並ぶ
    const xs = new Set(
      Array.from(svg.querySelectorAll('text[data-axis="y"]')).map((t) => t.getAttribute('x')),
    )
    expect(xs.size).toBe(1)
  })

  it('2系列以上のときは凡例を出し、1系列のときは出さない', () => {
    render(<Chart {...baseProps} />)
    const legend = screen.getByRole('list', { name: '凡例' })
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['収益', '費用'])
    cleanup()
    render(<Chart {...baseProps} series={[baseProps.series[0]]} />)
    expect(screen.queryByRole('list', { name: '凡例' })).toBeNull()
  })

  it('系列は固定の順序の色で塗り分ける', () => {
    const { container } = render(<Chart {...baseProps} />)
    expect(container.querySelector('path[data-series="0"]')).toHaveAttribute('fill', '#2A78D6')
    expect(container.querySelector('path[data-series="1"]')).toHaveAttribute('fill', '#EB6834')
  })

  it('折れ線は系列ごとに2pxの線を引き、線の端に系列名を直接ラベルで出す', () => {
    const { container } = render(<Chart {...baseProps} type="line" />)
    const lines = container.querySelectorAll('polyline')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toHaveAttribute('stroke-width', '2')
    expect(screen.getByRole('img', { name: baseProps.summary })).toHaveTextContent('収益')
  })

  it('積み上げでは系列の棒が同じ位置に重なって並ぶ', () => {
    const { container } = render(<Chart {...baseProps} type="stacked" />)
    const first = container.querySelector('path[data-series="0"][data-category="0"]')!
    const second = container.querySelector('path[data-series="1"][data-category="0"]')!
    expect(first).toBeInTheDocument()
    expect(second).toBeInTheDocument()
    expect(first.getAttribute('d')).not.toBe(second.getAttribute('d'))
  })

  it('同じ数値を「表で見る」で確認できる', () => {
    render(<Chart {...baseProps} />)
    const details = screen.getByText('数値を表で見る').closest('details')!
    const table = within(details).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: '収益' })).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: /12月/ })
    expect(row).toHaveTextContent('310,000円')
    expect(row).toHaveTextContent('400,000円')
  })
})

describe('Chart(ホバー・フォーカス・固定表示)', () => {
  it('カテゴリの領域にホバーまたはフォーカスすると、系列ごとの値をツールチップで表示し、外れると消える', () => {
    render(<Chart {...baseProps} />)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(hitOf(/11月/))
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('11月')
    expect(tip).toHaveTextContent('収益')
    expect(tip).toHaveTextContent('320,000円')
    expect(tip).toHaveTextContent('280,000円')
    fireEvent.mouseLeave(hitOf(/11月/))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.focus(hitOf(/12月/))
    expect(screen.getByRole('tooltip')).toHaveTextContent('400,000円')
    fireEvent.blur(hitOf(/12月/))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('各領域はキーボードで到達でき、読み上げ用に値を含むラベルを持つ', () => {
    render(<Chart {...baseProps} />)
    const hit = hitOf(/10月/)
    expect(hit).toHaveAttribute('tabindex', '0')
    expect(hit).toHaveAccessibleName(/収益 300,000円/)
  })

  it('←→キーで前後のカテゴリへフォーカスが移り、端では止まる', () => {
    render(<Chart {...baseProps} />)
    const first = hitOf(/10月/)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(hitOf(/11月/)).toHaveFocus()
    fireEvent.keyDown(hitOf(/11月/), { key: 'ArrowRight' })
    expect(hitOf(/12月/)).toHaveFocus()
    fireEvent.keyDown(hitOf(/12月/), { key: 'ArrowRight' })
    expect(hitOf(/12月/)).toHaveFocus()
    fireEvent.keyDown(hitOf(/12月/), { key: 'ArrowLeft' })
    expect(hitOf(/11月/)).toHaveFocus()
  })

  it('内訳(renderDetail)があるときは、クリックまたはEnterで固定表示し、閉じるボタンとEscで閉じる', () => {
    render(<Chart {...baseProps} renderDetail={(i) => <p>{`内訳の本文${i}`}</p>} />)
    expect(screen.queryByRole('region', { name: '11月の内訳' })).toBeNull()
    fireEvent.click(hitOf(/11月/))
    const region = screen.getByRole('region', { name: '11月の内訳' })
    expect(region).toHaveTextContent('内訳の本文1')
    fireEvent.click(within(region).getByRole('button', { name: '内訳を閉じる' }))
    expect(screen.queryByRole('region', { name: /の内訳$/ })).toBeNull()

    fireEvent.keyDown(hitOf(/12月/), { key: 'Enter' })
    expect(screen.getByRole('region', { name: '12月の内訳' })).toBeInTheDocument()
    fireEvent.keyDown(hitOf(/12月/), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: /の内訳$/ })).toBeNull()
  })

  it('同じカテゴリをもう一度クリックすると固定表示を解除する', () => {
    render(<Chart {...baseProps} renderDetail={() => <p>内訳</p>} />)
    fireEvent.click(hitOf(/10月/))
    fireEvent.click(hitOf(/10月/))
    expect(screen.queryByRole('region', { name: /の内訳$/ })).toBeNull()
  })

  it('内訳を渡さないときはクリックしても固定表示は出ない', () => {
    render(<Chart {...baseProps} />)
    fireEvent.click(hitOf(/10月/))
    expect(screen.queryByRole('region', { name: /の内訳$/ })).toBeNull()
  })
})

describe('HorizontalBarChart', () => {
  const items = [
    { key: 'food', name: '食費', value: 60000 },
    { key: 'rent', name: '家賃', value: 120000 },
    { key: 'misc', name: '雑費', value: 20000 },
  ]

  it('名称・棒・金額・構成比を1項目1行で並べ、棒の長さは最大値に対する割合にする', () => {
    render(<HorizontalBarChart title="費用の内訳" items={items} formatValue={yen} />)
    expect(screen.getByRole('heading', { name: '費用の内訳' })).toBeInTheDocument()
    const rent = screen.getByRole('button', { name: /家賃/ })
    expect(rent).toHaveTextContent('120,000円')
    expect(rent).toHaveTextContent('60%')
    expect(screen.getByRole('button', { name: /食費/ })).toHaveTextContent('30%')
    const bar = (name: RegExp) => screen.getByRole('button', { name }).querySelector<HTMLElement>('[data-bar]')!
    expect(bar(/家賃/).style.width).toBe('100%')
    expect(bar(/食費/).style.width).toBe('50%')
    expect(parseFloat(bar(/雑費/).style.width)).toBeCloseTo(16.67, 1)
  })

  it('行を押すと選択を通知する', () => {
    const onSelect = vi.fn()
    render(<HorizontalBarChart title="費用の内訳" items={items} formatValue={yen} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
    expect(onSelect).toHaveBeenCalledWith('rent')
  })

  it('項目がないときは「データがありません」を表示する', () => {
    render(<HorizontalBarChart title="費用の内訳" items={[]} formatValue={yen} />)
    expect(screen.getByText('データがありません')).toBeInTheDocument()
  })
})
