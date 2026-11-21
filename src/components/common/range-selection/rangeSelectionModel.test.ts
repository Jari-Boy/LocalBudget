/**
 * 範囲選択・トグル選択のルール(rangeSelectionModel)のテスト(計画Issue #235 D)。
 * Shift+クリックで基点からの範囲を選択に加えること、Ctrl/Cmd+クリックと修飾キーなしのクリックで1行を切り替えて
 * 基点を移すこと、基点が無い・別の範囲(scope)にあるときの扱い、選べない行(isSelectable)の除外、
 * Shift+↑↓で基点から現在位置までの範囲に置き換わる(広げる・縮める)こと、端でそれ以上動かないことを検証する。
 * 画面・DOM・DB には依存しない純粋関数のテスト(外部依存なし)。
 */
import { describe, expect, it } from 'vitest'
import { extendSelectionByArrow, pickItem } from './rangeSelectionModel'

const order = ['a', 'b', 'c', 'd', 'e']
const plain = { shiftKey: false, ctrlKey: false, metaKey: false }
const shift = { shiftKey: true, ctrlKey: false, metaKey: false }
const ctrl = { shiftKey: false, ctrlKey: true, metaKey: false }
const meta = { shiftKey: false, ctrlKey: false, metaKey: true }

describe('pickItem(クリックによる選択)', () => {
  it('修飾キーなしで未選択の行を押すと、その行が選択に加わり、基点になる', () => {
    expect(pickItem({ order, selected: [], anchor: null, id: 'b', modifiers: plain })).toEqual({ selected: ['b'], anchor: 'b' })
  })

  it('修飾キーなしで選択済みの行を押すと、その行だけ外れ、基点はその行に移る', () => {
    expect(pickItem({ order, selected: ['a', 'b'], anchor: 'a', id: 'b', modifiers: plain })).toEqual({ selected: ['a'], anchor: 'b' })
  })

  it('Ctrl+クリックと Cmd+クリックは、その行だけを切り替え、基点を移す(ほかの選択は変えない)', () => {
    expect(pickItem({ order, selected: ['a'], anchor: 'a', id: 'd', modifiers: ctrl })).toEqual({ selected: ['a', 'd'], anchor: 'd' })
    expect(pickItem({ order, selected: ['a', 'd'], anchor: 'd', id: 'a', modifiers: meta })).toEqual({ selected: ['d'], anchor: 'a' })
  })

  it('Shift+クリックで、基点から押した行までを、(基点・押した行を含めて)選択に加える。基点は動かない', () => {
    expect(pickItem({ order, selected: ['b'], anchor: 'b', id: 'd', modifiers: shift })).toEqual({ selected: ['b', 'c', 'd'], anchor: 'b' })
  })

  it('Shift+クリックは、基点より上の行にも使え、範囲は上下どちらの向きでも同じ', () => {
    expect(pickItem({ order, selected: ['d'], anchor: 'd', id: 'b', modifiers: shift })).toEqual({ selected: ['d', 'b', 'c'], anchor: 'd' })
  })

  it('Shift+クリックは、すでに選ばれている行を外さず、重複もさせない', () => {
    const result = pickItem({ order, selected: ['a', 'c', 'e'], anchor: 'a', id: 'c', modifiers: shift })
    expect([...result.selected].sort()).toEqual(['a', 'b', 'c', 'e'])
    expect(result.anchor).toBe('a')
  })

  it('基点がないときの Shift+クリックは、その行だけを切り替えて基点にする', () => {
    expect(pickItem({ order, selected: [], anchor: null, id: 'c', modifiers: shift })).toEqual({ selected: ['c'], anchor: 'c' })
  })

  it('基点が表示中の行にないとき(絞り込みなどで消えた)の Shift+クリックも、その行だけを切り替えて基点にする', () => {
    expect(pickItem({ order, selected: ['x'], anchor: 'x', id: 'c', modifiers: shift })).toEqual({ selected: ['x', 'c'], anchor: 'c' })
  })

  it('基点と押した行の範囲(scope)が違うときは、範囲選択にせず、その行だけを切り替えて基点にする(借方と貸方をまたがない)', () => {
    const scopeOf = (id: string) => (id === 'a' || id === 'b' ? 'debit' : 'credit')
    expect(pickItem({ order, selected: ['a'], anchor: 'a', id: 'd', modifiers: shift, scopeOf })).toEqual({ selected: ['a', 'd'], anchor: 'd' })
  })

  it('同じ範囲(scope)の中だけを範囲選択の対象にし、間にある別の範囲の行は含めない', () => {
    const scopeOf = (id: string) => (id === 'b' || id === 'd' ? 'credit' : 'debit')
    const result = pickItem({ order, selected: ['a'], anchor: 'a', id: 'e', modifiers: shift, scopeOf })
    expect([...result.selected].sort()).toEqual(['a', 'c', 'e'])
  })

  it('選べない行(isSelectable が false)は、範囲選択に含めず、クリックしても切り替えない', () => {
    const isSelectable = (id: string) => id !== 'c'
    expect(pickItem({ order, selected: ['a'], anchor: 'a', id: 'e', modifiers: shift, isSelectable }).selected).toEqual(['a', 'b', 'd', 'e'])
    expect(pickItem({ order, selected: ['a'], anchor: 'a', id: 'c', modifiers: plain, isSelectable })).toEqual({ selected: ['a'], anchor: 'a' })
  })

  it('渡した選択の配列は書き換えない', () => {
    const selected = ['a']
    pickItem({ order, selected, anchor: 'a', id: 'c', modifiers: shift })
    expect(selected).toEqual(['a'])
  })
})

describe('extendSelectionByArrow(Shift+↑↓)', () => {
  it('基点がないとき、押した行を基点にして、1つ下の行までを選択に加え、フォーカスを1つ下へ移す', () => {
    expect(extendSelectionByArrow({ order, selected: [], anchor: null, focusedId: 'b', direction: 'down' })).toEqual({
      selected: ['b', 'c'],
      anchor: 'b',
      focusId: 'c',
    })
  })

  it('下へ続けて押すと、基点から現在位置までの範囲が広がる', () => {
    const first = extendSelectionByArrow({ order, selected: [], anchor: null, focusedId: 'a', direction: 'down' })
    const second = extendSelectionByArrow({ order, selected: first.selected, anchor: first.anchor, focusedId: first.focusId, direction: 'down' })
    expect(second.selected).toEqual(['a', 'b', 'c'])
    expect(second.focusId).toBe('c')
    expect(second.anchor).toBe('a')
  })

  it('広げたあとに逆向きへ押すと、範囲が縮み、基点から外れた行の選択が外れる', () => {
    const result = extendSelectionByArrow({ order, selected: ['a', 'b', 'c'], anchor: 'a', focusedId: 'c', direction: 'up' })
    expect(result.selected).toEqual(['a', 'b'])
    expect(result.focusId).toBe('b')
  })

  it('基点を越えて逆向きへ進むと、基点の反対側へ範囲が広がる', () => {
    const result = extendSelectionByArrow({ order, selected: ['c'], anchor: 'c', focusedId: 'c', direction: 'up' })
    expect(result.selected).toEqual(['c', 'b'])
    const result2 = extendSelectionByArrow({ order, selected: result.selected, anchor: 'c', focusedId: 'b', direction: 'up' })
    expect([...result2.selected].sort()).toEqual(['a', 'b', 'c'])
  })

  it('範囲の外で、Shift+↑↓以外の方法で選んでいた行は、縮めても外さない', () => {
    const result = extendSelectionByArrow({ order, selected: ['a', 'b', 'c', 'e'], anchor: 'a', focusedId: 'c', direction: 'up' })
    expect([...result.selected].sort()).toEqual(['a', 'b', 'e'])
  })

  it('先頭・末尾では、それ以上は動かず、選択もフォーカスも変えない', () => {
    expect(extendSelectionByArrow({ order, selected: ['a'], anchor: 'a', focusedId: 'a', direction: 'up' })).toEqual({
      selected: ['a'],
      anchor: 'a',
      focusId: 'a',
    })
    expect(extendSelectionByArrow({ order, selected: ['e'], anchor: 'e', focusedId: 'e', direction: 'down' }).focusId).toBe('e')
  })

  it('選べない行(isSelectable が false)は飛ばして、次の選べる行へ進む', () => {
    const isSelectable = (id: string) => id !== 'b'
    const result = extendSelectionByArrow({ order, selected: [], anchor: null, focusedId: 'a', direction: 'down', isSelectable })
    expect(result.selected).toEqual(['a', 'c'])
    expect(result.focusId).toBe('c')
  })

  it('同じ範囲(scope)の行だけをたどる(別の範囲の行は飛ばす)', () => {
    const scopeOf = (id: string) => (id === 'b' || id === 'd' ? 'credit' : 'debit')
    const result = extendSelectionByArrow({ order, selected: [], anchor: null, focusedId: 'a', direction: 'down', scopeOf })
    expect(result.focusId).toBe('c')
    expect(result.selected).toEqual(['a', 'c'])
  })

  it('フォーカス中の行が表示中の行にないときは、何も変えない', () => {
    expect(extendSelectionByArrow({ order, selected: ['a'], anchor: 'a', focusedId: 'zzz', direction: 'down' })).toEqual({
      selected: ['a'],
      anchor: 'a',
      focusId: null,
    })
  })
})
