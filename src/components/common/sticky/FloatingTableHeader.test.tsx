// @vitest-environment jsdom
/**
 * FloatingTableHeader(横スクロールする表の見出しを、ページのスクロールで画面の上部に固定する部品、計画Issue #266)のテスト。
 * 横スクロール用の枠(overflow-x: auto)の中では、ページのスクロールで見出しを固定できない(sticky は枠の縦スクロールにしか効かない)ため、
 * 枠の外に見出しの複製を置き、本物の見出しが固定位置より上へスクロールアウトしたときだけ見せる。
 * 複製は、見えていない間は支援技術にも操作にも出ず、見えている間は表の横スクロールに合わせて動く。
 * 外部依存はなく、位置は jsdom では計算されないため、テスト内で偽の値に差し替える。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { FloatingTableHeader } from './FloatingTableHeader'

afterEach(cleanup)

/** 偽の位置(画面の上端からの距離)。floatingTop は固定の位置(固定中はその値、固定前は表の上端) */
const rects = { floatingTop: 0, headTop: 40, tableBottom: 500 }

function rect(top: number, bottom = top): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function Harness({ syncColumnWidths = false }: { syncColumnWidths?: boolean }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [table, setTable] = useState<HTMLTableElement | null>(null)
  return (
    <div>
      <FloatingTableHeader scroller={scroller} table={table} syncColumnWidths={syncColumnWidths}>
        <thead>
          <tr>
            <th>日付</th>
            <th>摘要</th>
          </tr>
        </thead>
      </FloatingTableHeader>
      <div ref={setScroller} data-testid="scroller">
        <table
          ref={(el) => {
            if (el !== null && !('stubbed' in el)) {
              Object.defineProperty(el, 'stubbed', { value: true })
              el.getBoundingClientRect = () => rect(rects.headTop - 1, rects.tableBottom)
              const head = el.tHead
              if (head !== null) head.getBoundingClientRect = () => rect(rects.headTop, rects.headTop + 30)
              // 本物の見出しの列幅(1列目 24px、2列目 180px)と表の幅(204px)。列幅の複製のテスト用
              const cells = el.tHead?.rows[0]?.cells
              if (cells !== undefined) {
                const widths = [24, 180]
                Array.from(cells).forEach((cell, i) => {
                  cell.getBoundingClientRect = () => ({ ...rect(0), width: widths[i] }) as DOMRect
                })
                el.getBoundingClientRect = () => ({ ...rect(rects.headTop - 1, rects.tableBottom), width: 204 }) as DOMRect
              }
            }
            setTable(el)
          }}
          aria-label="本物の表"
        >
          <thead>
            <tr>
              <th>日付</th>
              <th>摘要</th>
            </tr>
          </thead>
        </table>
      </div>
    </div>
  )
}

/** 偽の位置を差し替えて、ページがスクロールされたことを伝える */
function scrollPageTo(positions: Partial<typeof rects>) {
  Object.assign(rects, positions)
  act(() => {
    window.dispatchEvent(new Event('scroll'))
  })
}

const floating = () => document.querySelector('.floating-table-header') as HTMLElement
const cloneTable = () => document.querySelector('.floating-table-header table') as HTMLElement

function stubFloating() {
  floating().getBoundingClientRect = () => rect(rects.floatingTop)
}

describe('FloatingTableHeader', () => {
  it('見出しが画面内にあるうちは、複製は見せず、支援技術にも操作にも出さない', () => {
    Object.assign(rects, { floatingTop: 0, headTop: 40, tableBottom: 500 })
    render(<Harness />)
    stubFloating()
    scrollPageTo({})

    expect(floating()).toHaveAttribute('data-stuck', 'false')
    expect(floating()).toHaveAttribute('aria-hidden', 'true')
    expect(floating()).toHaveAttribute('inert')
    // 本物の見出しだけが、支援技術の見る列見出しになる(複製は重ならない)
    expect(screen.getAllByRole('columnheader', { name: '日付' })).toHaveLength(1)
  })

  it('本物の見出しが固定の位置より上へスクロールアウトしたら、複製を見せる(固定中は操作できる)', () => {
    render(<Harness />)
    stubFloating()

    scrollPageTo({ floatingTop: 120, headTop: -300, tableBottom: 900 })

    expect(floating()).toHaveAttribute('data-stuck', 'true')
    expect(floating()).not.toHaveAttribute('inert')
    expect(floating()).toHaveAttribute('aria-hidden', 'false')
  })

  it('表の下端が固定の位置より上に抜けたら、複製は消える(最後の行の下に見出しが出ない)', () => {
    render(<Harness />)
    stubFloating()
    scrollPageTo({ floatingTop: 120, headTop: -300, tableBottom: 900 })
    expect(floating()).toHaveAttribute('data-stuck', 'true')

    // 表の下端(110)が固定の位置(120)より上に抜けている(jsdom では見出しの高さが 0 のため、固定の位置と比べるだけになる)
    scrollPageTo({ floatingTop: 120, headTop: -1000, tableBottom: 110 })

    expect(floating()).toHaveAttribute('data-stuck', 'false')
  })

  it('スクロールして戻れば、複製はまた消える', () => {
    render(<Harness />)
    stubFloating()
    scrollPageTo({ floatingTop: 120, headTop: -300, tableBottom: 900 })

    scrollPageTo({ floatingTop: 0, headTop: 40, tableBottom: 500 })

    expect(floating()).toHaveAttribute('data-stuck', 'false')
  })

  it('表を横にスクロールすると、複製も同じだけ横へ動く(列が本物の見出しとずれない)', () => {
    render(<Harness />)
    const scroller = screen.getByTestId('scroller')

    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, value: 180 })
    act(() => {
      scroller.dispatchEvent(new Event('scroll'))
    })

    expect(cloneTable().style.transform).toBe('translateX(-180px)')
  })

  it('列幅の複製を頼んだときは、固定中に、本物の見出しの列幅と表の幅を複製に写す(列が本物の見出しとずれない)', () => {
    render(<Harness syncColumnWidths />)
    stubFloating()

    scrollPageTo({ floatingTop: 120, headTop: -300, tableBottom: 900 })

    const cells = cloneTable().querySelectorAll('th')
    expect(cells[0].style.width).toBe('24px')
    expect(cells[1].style.width).toBe('180px')
    // 列幅は本物の見出しのセル全体の幅(パディングを含む)なので、複製のセルも border-box にして、パディングの分だけ広がらないようにする
    expect(cells[0].style.boxSizing).toBe('border-box')
    expect(cells[1].style.boxSizing).toBe('border-box')
    expect(cloneTable().style.width).toBe('204px')
    expect(cloneTable().style.tableLayout).toBe('fixed')
  })

  it('列幅の複製を頼まなければ、複製の列幅には触れない(列幅は渡した colgroup で決める表向け)', () => {
    render(<Harness />)
    stubFloating()

    scrollPageTo({ floatingTop: 120, headTop: -300, tableBottom: 900 })

    expect(cloneTable().querySelectorAll('th')[0].style.width).toBe('')
    expect(cloneTable().style.tableLayout).toBe('')
  })
  it('複製の表にも、渡した見出しの中身(列見出し)が入っている', () => {
    render(<Harness />)

    expect(cloneTable().querySelectorAll('th')).toHaveLength(2)
    expect(cloneTable().textContent).toContain('日付')
  })
})
