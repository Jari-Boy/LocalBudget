// @vitest-environment jsdom
/**
 * SortableHeaderCell(表の列見出しの並び替えボタン、計画Issue #302)のコンポーネントテスト。
 * 見出しのセル(th)が、並び替えの状態に応じた aria-sort(none・ascending・descending)を持ち、
 * 中のボタンを押すと onSort が呼ばれること、見出しの文字がボタンの名前になること、
 * 列幅のつまみなど追加の中身(children)を同じセルに置けることを検証する。DB・外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SortableHeaderCell } from './SortableHeaderCell'

afterEach(cleanup)

function renderCell(props: Partial<React.ComponentProps<typeof SortableHeaderCell>> = {}) {
  return render(
    <table>
      <thead>
        <tr>
          <SortableHeaderCell label="日付" direction={null} onSort={() => {}} {...props} />
        </tr>
      </thead>
    </table>,
  )
}

describe('SortableHeaderCell', () => {
  it('並び替えていない列は aria-sort が none で、見出しの文字がボタンの名前になる', () => {
    renderCell()
    expect(screen.getByRole('columnheader', { name: '日付' })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('button', { name: '日付' })).toBeInTheDocument()
  })

  it('昇順の列は ascending、降順の列は descending になる', () => {
    const { unmount } = renderCell({ direction: 'asc' })
    expect(screen.getByRole('columnheader', { name: '日付' })).toHaveAttribute('aria-sort', 'ascending')
    unmount()
    renderCell({ direction: 'desc' })
    expect(screen.getByRole('columnheader', { name: '日付' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('ボタンを押すと onSort が呼ばれる', () => {
    const onSort = vi.fn()
    renderCell({ onSort })
    fireEvent.click(screen.getByRole('button', { name: '日付' }))
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('children(列幅のつまみなど)を同じセルに置ける', () => {
    renderCell({ children: <span data-testid="extra" /> })
    expect(screen.getByRole('columnheader', { name: '日付' })).toContainElement(screen.getByTestId('extra'))
  })

  it('className と scope がセルに付く', () => {
    renderCell({ className: 'amount', scope: 'col' })
    const cell = screen.getByRole('columnheader', { name: '日付' })
    expect(cell).toHaveClass('amount')
    expect(cell).toHaveAttribute('scope', 'col')
  })
})
