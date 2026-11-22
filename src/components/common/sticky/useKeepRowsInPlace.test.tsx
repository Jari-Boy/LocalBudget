// @vitest-environment jsdom
/**
 * useKeepRowsInPlace(一括編集バーの出入りで行が動かないようにするフック、計画Issue #266)のテスト。
 * バーが出る・消えると、その下の表がバーの高さの分だけ上下にずれる。そのずれと同じだけページをスクロールして、
 * 画面上の行の位置を保つ。外部依存はなく、位置・スクロールは jsdom では計算されないため、テスト内で偽の値に差し替える。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeepRowsInPlace } from './useKeepRowsInPlace'

/** 偽の表の位置(画面の上端からの距離)。呼び出しごとに差し替える */
const anchor = { top: 100 }
let scrollBy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  anchor.top = 100
  scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Probe({ visible }: { visible: boolean }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  if (element !== null && !('stubbed' in element)) {
    Object.defineProperty(element, 'stubbed', { value: true })
    element.getBoundingClientRect = () => ({ top: anchor.top }) as DOMRect
  }
  useKeepRowsInPlace(visible, element)
  return <div ref={setElement} data-testid="anchor" />
}

describe('useKeepRowsInPlace', () => {
  it('最初の描画では何も動かさない', () => {
    render(<Probe visible={false} />)

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('バーが出て表の上端が下がったぶん、ページを下へスクロールする(行が画面上で動かない)', () => {
    const { rerender } = render(<Probe visible={false} />)

    anchor.top = 166 // バーが出て、表が66px下がる
    rerender(<Probe visible />)

    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith(0, 66)
  })

  it('バーが消えて表の上端が上がったぶん、ページを上へスクロールする', () => {
    anchor.top = 166
    const { rerender } = render(<Probe visible />)

    anchor.top = 100
    rerender(<Probe visible={false} />)

    expect(scrollBy).toHaveBeenCalledWith(0, -66)
  })

  it('表の上端が動かなければ、バーが出ても何も動かさない', () => {
    const { rerender } = render(<Probe visible={false} />)

    rerender(<Probe visible />)

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('バーの出入りがない再描画では、表の位置が変わっても動かさない', () => {
    const { rerender } = render(<Probe visible />)

    anchor.top = 250
    rerender(<Probe visible />)

    expect(scrollBy).not.toHaveBeenCalled()
  })
})
