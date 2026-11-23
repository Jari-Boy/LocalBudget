// @vitest-environment jsdom
/**
 * StickyToolbar(一覧の上の検索・追加ボタンの行を、画面の上部に固定する部品、計画Issue #266)のテスト。
 * 固定した行の高さを、親(一覧の列)の CSS 変数 --sticky-head-extra に入れて、その下に固定する表の見出しの複製が重ならないようにする。
 * 外部依存はなく、ResizeObserver は jsdom に無いためテスト内で偽物に差し替える。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StickyToolbar } from './StickyToolbar'

let callbacks: ResizeObserverCallback[] = []

beforeEach(() => {
  callbacks = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderToolbar() {
  return render(
    <div data-testid="column">
      <StickyToolbar className="master-actions">
        <button type="button">追加</button>
      </StickyToolbar>
    </div>,
  )
}

describe('StickyToolbar', () => {
  it('子要素を、渡したクラス名と固定用のクラス名つきの行の中に出す', () => {
    renderToolbar()

    const button = screen.getByRole('button', { name: '追加' })
    expect(button.parentElement).toHaveClass('master-actions')
    expect(button.parentElement).toHaveClass('sticky-toolbar')
  })

  it('行の高さを、親の --sticky-head-extra に入れる(高さが変わると追従する)', () => {
    renderToolbar()
    const row = screen.getByRole('button', { name: '追加' }).parentElement as HTMLElement
    expect(screen.getByTestId('column').style.getPropertyValue('--sticky-head-extra')).toBe('0px')

    Object.defineProperty(row, 'offsetHeight', { configurable: true, value: 56 })
    act(() => {
      for (const callback of callbacks) callback([], {} as ResizeObserver)
    })

    expect(screen.getByTestId('column').style.getPropertyValue('--sticky-head-extra')).toBe('56px')
  })

  it('取り外すと、親の --sticky-head-extra を消す', () => {
    const { unmount } = renderToolbar()
    const column = screen.getByTestId('column')

    unmount()

    expect(column.style.getPropertyValue('--sticky-head-extra')).toBe('')
  })
})
