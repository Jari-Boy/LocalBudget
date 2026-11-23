// @vitest-environment jsdom
/**
 * StickyHeaderTable(見出しをページのスクロールで画面の上部に固定する表、計画Issue #266)のテスト。
 * 横スクロール用の枠・表・見出しの複製(FloatingTableHeader)をまとめて出す部品で、マスタや割勘などの
 * 見出しが1行の表に使う。固定の動き(位置・列幅の複製)は FloatingTableHeader のテストで検証する。
 * ここでは、本物の表が名前・クラス・見出し・本文を持つこと、見出しの複製が支援技術に重ならないこと、枠が表の直前の複製と並ぶことを検証する。
 * 外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StickyHeaderTable } from './StickyHeaderTable'

afterEach(cleanup)

function renderTable() {
  return render(
    <StickyHeaderTable
      frameClassName="demo-frame"
      tableClassName="demo-table"
      aria-label="デモの表"
      head={
        <thead>
          <tr>
            <th>名称</th>
            <th>種別</th>
          </tr>
        </thead>
      }
    >
      <tbody>
        <tr>
          <td>食費</td>
          <td>費用</td>
        </tr>
      </tbody>
    </StickyHeaderTable>,
  )
}

describe('StickyHeaderTable', () => {
  it('本物の表は、名前・クラス・見出し・本文を持ち、横スクロール用の枠の中にある', () => {
    renderTable()

    const table = screen.getByRole('table', { name: 'デモの表' })
    expect(table).toHaveClass('demo-table')
    expect(table.closest('.demo-frame')).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(within(table).getByRole('cell', { name: '食費' })).toBeInTheDocument()
  })

  it('見出しの複製は表の枠の直前にあり、支援技術には出ない(列見出しは本物の1つだけ)', () => {
    const { container } = renderTable()

    const floating = container.querySelector('.floating-table-header') as HTMLElement
    expect(floating).toHaveAttribute('aria-hidden', 'true')
    expect(floating.nextElementSibling).toBe(container.querySelector('.demo-frame'))
    expect(screen.getAllByRole('columnheader', { name: '名称' })).toHaveLength(1)
  })

  it('複製の表にも、表のクラスと見出しの中身が入る(本物の表と同じ見た目・列にするため)', () => {
    const { container } = renderTable()

    const clone = container.querySelector('.floating-table-header table') as HTMLElement
    expect(clone).toHaveClass('demo-table')
    expect(clone.querySelectorAll('th')).toHaveLength(2)
    expect(clone.querySelector('tbody')).toBeNull()
  })
})
