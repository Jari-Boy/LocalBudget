// @vitest-environment jsdom
/**
 * 詳細パネルの Esc キー(useEscapeDiscard、計画Issue #237)のテスト。
 * 変更があるときだけ、パネルの中で押した Esc が「変更を破棄しますか?」の確認(ConfirmDialog)を開くこと、
 * 確認ではフォーカスが「破棄する」にあり、押すと破棄(onDiscard)、「編集を続ける」・Esc では何も破棄しないことを検証する。
 * 日本語入力の変換中の Esc、他の部品が処理済み(preventDefault)の Esc、ダイアログの中の Esc は対象外であることも確認する。
 * 外部依存: なし(jsdom。DB・Repository・ルーターには依存しない)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEscapeDiscard } from './useEscapeDiscard'

afterEach(cleanup)

function Panel({ dirty, onDiscard }: { dirty: boolean; onDiscard: () => void }) {
  const escape = useEscapeDiscard({ dirty, onDiscard })
  return (
    <section aria-label="パネル" onKeyDown={escape.onKeyDown}>
      <input aria-label="名称" />
      <button type="button">他のボタン</button>
      {escape.dialog}
    </section>
  )
}

function setup(dirty: boolean) {
  const onDiscard = vi.fn()
  render(<Panel dirty={dirty} onDiscard={onDiscard} />)
  return { onDiscard, input: screen.getByRole('textbox', { name: '名称' }) }
}

describe('useEscapeDiscard', () => {
  it('変更があるとき、パネル内のEscで「変更を破棄しますか?」を開き、フォーカスは「破棄する」に置く', () => {
    const { input } = setup(true)

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByRole('dialog', { name: '変更を破棄しますか?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '破棄する' })).toHaveFocus()
  })

  it('変更が無いときは、Escを押しても何も出さない', () => {
    const { input } = setup(false)

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Esc以外のキーでは開かない', () => {
    const { input } = setup(true)

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('日本語入力の変換中(isComposing・keyCode 229)のEscは対象外', () => {
    const { input } = setup(true)

    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('他の部品がpreventDefaultで処理済みのEsc(選択欄のポップアップを閉じる等)は対象外', () => {
    const onDiscard = vi.fn()
    function WithPopup() {
      const escape = useEscapeDiscard({ dirty: true, onDiscard })
      return (
        <section onKeyDown={escape.onKeyDown}>
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            選択欄
          </button>
          {escape.dialog}
        </section>
      )
    }
    render(<WithPopup />)

    fireEvent.keyDown(screen.getByRole('button', { name: '選択欄' }), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('「破棄する」で onDiscard が1回呼ばれ、確認が閉じる', () => {
    const { input, onDiscard } = setup(true)
    fireEvent.keyDown(input, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '破棄する' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('「編集を続ける」では破棄せず、確認だけが閉じる', () => {
    const { input, onDiscard } = setup(true)
    fireEvent.keyDown(input, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '編集を続ける' }))

    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('確認の中のEscは「編集を続ける」と同じで、破棄せず確認を開き直さない', () => {
    const { input, onDiscard } = setup(true)
    fireEvent.keyDown(input, { key: 'Escape' })

    fireEvent.keyDown(screen.getByRole('button', { name: '破棄する' }), { key: 'Escape' })

    expect(onDiscard).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
