// @vitest-environment jsdom
/**
 * useKeepRowsInPlace(一括編集バーの出入りで行が動かないようにするフック、計画Issue #266)のテスト。
 * バーが出る・消えると、その下の表の枠が上下にずれる。そのずれと同じだけ、枠の中のスクロール位置を動かして、
 * 画面上の行の位置を保つ。枠の中で動かせない分(端まで来ている)は、ページのスクロールで補う。
 * 外部依存はなく、位置・スクロールは jsdom では計算されないため、テスト内で偽の値に差し替える。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKeepRowsInPlace } from './useKeepRowsInPlace'

/** 偽の枠。位置(top)は呼び出しごとに差し替え、scrollTop は上限(max)で止める */
const region = { top: 100, scrollTop: 0, max: 1000 }
let scrollBy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  region.top = 100
  region.scrollTop = 0
  region.max = 1000
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
    element.getBoundingClientRect = () => ({ top: region.top }) as DOMRect
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => region.scrollTop,
      set: (value: number) => {
        region.scrollTop = Math.max(0, Math.min(region.max, value))
      },
    })
  }
  useKeepRowsInPlace(visible, element)
  return <div ref={setElement} data-testid="region" />
}

describe('useKeepRowsInPlace', () => {
  it('最初の描画では何も動かさない', () => {
    render(<Probe visible={false} />)

    expect(region.scrollTop).toBe(0)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('バーが出て枠の上端が下がったぶん、枠の中のスクロールを進める(行が画面上で動かない)', () => {
    region.scrollTop = 300
    const { rerender } = render(<Probe visible={false} />)

    region.top = 166 // バーが出て、枠が66px下がる
    rerender(<Probe visible />)

    expect(region.scrollTop).toBe(366)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('バーが消えて枠の上端が上がったぶん、枠の中のスクロールを戻す', () => {
    region.top = 166
    region.scrollTop = 366
    const { rerender } = render(<Probe visible />)

    region.top = 100
    rerender(<Probe visible={false} />)

    expect(region.scrollTop).toBe(300)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('枠の中で進める余地が足りないときは、残りをページのスクロールで補う', () => {
    region.scrollTop = 0
    region.max = 20 // 枠の中は20pxしか進められない
    const { rerender } = render(<Probe visible={false} />)

    region.top = 166
    rerender(<Probe visible />)

    expect(region.scrollTop).toBe(20)
    expect(scrollBy).toHaveBeenCalledWith(0, 46)
  })

  it('枠の上端が動かなければ、バーが出ても何も動かさない', () => {
    region.scrollTop = 300
    const { rerender } = render(<Probe visible={false} />)

    rerender(<Probe visible />)

    expect(region.scrollTop).toBe(300)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('バーの出入りがない再描画では、枠の位置が変わっても動かさない', () => {
    region.scrollTop = 300
    const { rerender } = render(<Probe visible />)

    region.top = 250
    rerender(<Probe visible />)

    expect(region.scrollTop).toBe(300)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
