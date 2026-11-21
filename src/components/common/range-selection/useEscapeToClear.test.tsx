// @vitest-environment jsdom
/**
 * 「Esc で選択を全解除」の共通フック(useEscapeToClear)のコンポーネントテスト(計画Issue #235 D)。
 * Esc を押すと渡した解除の処理が呼ばれること、解除する選択がないとき(null)は何もしないこと、入力中・select・ダイアログの中・
 * 子がすでに処理した(defaultPrevented)Esc には反応しないこと、チェックボックスやボタンにフォーカスがあるときは反応すること、
 * 描画のたびに渡し直した最新の処理が呼ばれること、画面を離れたあとは反応しないことを検証する。
 * 外部依存なし(フックを使う最小のコンポーネントを描画して、document にキーイベントを送る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEscapeToClear } from './useEscapeToClear'

afterEach(cleanup)

function Probe({ onClear }: { onClear: (() => void) | null }) {
  useEscapeToClear(onClear)
  return (
    <div>
      <input type="text" aria-label="検索" />
      <select aria-label="種類">
        <option>a</option>
      </select>
      <input type="checkbox" aria-label="チェック" />
      <button type="button">ボタン</button>
      <div role="dialog" aria-label="選択ダイアログ">
        <button type="button">ダイアログ内</button>
      </div>
    </div>
  )
}

describe('useEscapeToClear', () => {
  it('Esc を押すと、解除の処理が呼ばれる', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('解除する選択がないとき(null)は、Esc を押しても何も起きない', () => {
    const onClear = vi.fn()
    const view = render(<Probe onClear={null} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
    view.rerender(<Probe onClear={onClear} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('Esc 以外のキーでは呼ばれない', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    fireEvent.keyDown(document.body, { key: 'a' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('テキスト入力欄・select にフォーカスがあるときの Esc では、呼ばれない', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    fireEvent.keyDown(screen.getByLabelText('検索'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByLabelText('種類'), { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('ダイアログの中の Esc では、呼ばれない(ダイアログを閉じる操作に任せる)', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'ダイアログ内' }), { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('チェックボックス・ボタンにフォーカスがあるときの Esc では、呼ばれる(チェックを押した直後に解除できる)', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'チェック' }), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'ボタン' }), { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(2)
  })

  it('子がすでに処理した(defaultPrevented)Esc では、呼ばれない', () => {
    const onClear = vi.fn()
    render(<Probe onClear={onClear} />)
    const button = screen.getByRole('button', { name: 'ボタン' })
    button.addEventListener('keydown', (event) => event.preventDefault())
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
  })

  it('描画のたびに渡し直した最新の処理が呼ばれる(古い処理は呼ばれない)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Probe onClear={first} />)
    view.rerender(<Probe onClear={second} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('画面を離れたあとは、Esc を押しても呼ばれない', () => {
    const onClear = vi.fn()
    const view = render(<Probe onClear={onClear} />)
    view.unmount()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClear).not.toHaveBeenCalled()
  })
})
