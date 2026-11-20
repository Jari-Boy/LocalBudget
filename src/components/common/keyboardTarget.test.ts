// @vitest-environment jsdom
/**
 * キー操作の対象要素の判定(keyboardTarget)のテスト(計画Issue #235)。
 * 選択の全解除(Esc)や範囲選択(Shift+↑↓)のような画面全体のキー操作が、テキスト入力・select・ダイアログの中の
 * 操作と競合しないよう、押された時点の対象要素から「その操作に任せるべきか」を判定する関数を検証する。
 * 外部依存なし(jsdom の DOM 要素を作って渡すだけ)。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { isTextEntryTarget, ownsEscapeKey } from './keyboardTarget'

afterEach(() => {
  document.body.innerHTML = ''
})

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body.firstElementChild as HTMLElement
}

describe('isTextEntryTarget', () => {
  it('テキスト入力・数値入力・検索欄・textarea・select は、文字入力の対象として true を返す', () => {
    for (const html of ['<input type="text">', '<input>', '<input type="number">', '<input type="search">', '<textarea></textarea>', '<select></select>']) {
      expect(isTextEntryTarget(mount(html))).toBe(true)
    }
  })

  it('チェックボックス・ラジオ・ボタンは、文字入力の対象ではないので false を返す(チェックを押したあとの Esc を奪わない)', () => {
    for (const html of ['<input type="checkbox">', '<input type="radio">', '<input type="button">', '<button></button>']) {
      expect(isTextEntryTarget(mount(html))).toBe(false)
    }
  })

  it('contenteditable の要素と、その中の要素は true を返す', () => {
    const root = mount('<div contenteditable="true"><span id="inner">a</span></div>')
    expect(isTextEntryTarget(root)).toBe(true)
    expect(isTextEntryTarget(root.querySelector('#inner'))).toBe(true)
  })

  it('body・通常の要素・null は false を返す', () => {
    expect(isTextEntryTarget(document.body)).toBe(false)
    expect(isTextEntryTarget(mount('<div></div>'))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
  })

  it('要素ではない対象(window など)は false を返す', () => {
    expect(isTextEntryTarget(window)).toBe(false)
  })
})

describe('ownsEscapeKey', () => {
  it('文字入力の対象は、Esc を自分で扱うので true を返す', () => {
    expect(ownsEscapeKey(mount('<input type="text">'))).toBe(true)
  })

  it('role="dialog" の中の要素は、Esc でダイアログを閉じるので true を返す', () => {
    const root = mount('<div role="dialog"><button id="b">閉じる</button></div>')
    expect(ownsEscapeKey(root.querySelector('#b'))).toBe(true)
    expect(ownsEscapeKey(root)).toBe(true)
  })

  it('aria-modal="true" の中の要素も true を返す', () => {
    const root = mount('<div aria-modal="true"><button id="b">閉じる</button></div>')
    expect(ownsEscapeKey(root.querySelector('#b'))).toBe(true)
  })

  it('ダイアログの外の通常の要素・チェックボックス・body は false を返す', () => {
    expect(ownsEscapeKey(document.body)).toBe(false)
    expect(ownsEscapeKey(mount('<input type="checkbox">'))).toBe(false)
    expect(ownsEscapeKey(mount('<button></button>'))).toBe(false)
  })
})
