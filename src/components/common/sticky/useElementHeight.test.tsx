// @vitest-environment jsdom
/**
 * useElementHeight(固定する要素の高さを測るフック、計画Issue #266)のテスト。
 * 上部に固定する要素(タブ・絞り込み欄)の高さを CSS 変数として下の固定要素(一括編集バー)の top に渡すために、
 * 要素の高さを ResizeObserver で追い続けることを検証する。外部依存はなく、ResizeObserver は jsdom に無いためテスト内で偽物に差し替える。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useElementHeight } from './useElementHeight'

type Callback = ResizeObserverCallback
let callbacks: Callback[] = []
let observed: Element[] = []
let disconnected = 0

beforeEach(() => {
  callbacks = []
  observed = []
  disconnected = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: Callback) {
        callbacks.push(callback)
      }
      observe(target: Element) {
        observed.push(target)
      }
      disconnect() {
        disconnected += 1
      }
      unobserve() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** 要素は state に入れて渡す(コールバック ref)。画面が読み込み中のあとに要素を描く場合でも、現れた時点から測れる */
function Probe({ initial, show = true }: { initial: number; show?: boolean }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const height = useElementHeight(element)
  return (
    <div>
      {show && <div ref={setElement} data-testid="target" style={{ height: initial }} />}
      <output data-testid="height">{height}</output>
    </div>
  )
}

/** 偽の ResizeObserver に、要素の高さが変わったと伝える */
function resizeTo(height: number) {
  const target = observed[0] as HTMLElement
  Object.defineProperty(target, 'offsetHeight', { configurable: true, value: height })
  act(() => {
    for (const callback of callbacks) callback([], {} as ResizeObserver)
  })
}

describe('useElementHeight', () => {
  it('要素を監視し、最初は測った高さ(jsdomでは0)を返す', () => {
    render(<Probe initial={40} />)

    expect(observed).toContain(screen.getByTestId('target'))
    expect(screen.getByTestId('height')).toHaveTextContent(/^0$/)
  })

  it('要素の高さが変わると、新しい高さを返す', () => {
    render(<Probe initial={40} />)

    resizeTo(88)

    expect(screen.getByTestId('height')).toHaveTextContent('88')
  })

  it('要素が最初は無く、あとから現れた場合も、現れた時点から監視して高さを返す(読み込み中のあとに描かれる画面)', () => {
    const { rerender } = render(<Probe initial={40} show={false} />)
    expect(observed).toHaveLength(0)

    rerender(<Probe initial={40} show />)
    expect(observed).toContain(screen.getByTestId('target'))
    resizeTo(120)

    expect(screen.getByTestId('height')).toHaveTextContent('120')
  })

  it('要素が消えたら(絞り込み欄を閉じたときなど)、高さは0に戻る', () => {
    const { rerender } = render(<Probe initial={40} show />)
    resizeTo(120)
    expect(screen.getByTestId('height')).toHaveTextContent('120')

    rerender(<Probe initial={40} show={false} />)

    expect(screen.getByTestId('height')).toHaveTextContent(/^0$/)
  })

  it('取り外すと、監視をやめる', () => {
    const { unmount } = render(<Probe initial={40} />)

    unmount()

    expect(disconnected).toBe(1)
  })

  it('ResizeObserver が無い環境でも落ちず、0を返す', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('ResizeObserver', undefined)

    render(<Probe initial={40} />)

    expect(screen.getByTestId('height')).toHaveTextContent(/^0$/)
  })
})
