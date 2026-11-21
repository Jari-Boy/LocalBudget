// @vitest-environment jsdom
/**
 * 範囲選択の共通フック(useRangeSelection)のコンポーネントテスト(計画Issue #235 D)。
 * チェックボックスに渡す props(checkboxProps)で、修飾キーなしのクリックが1行の切り替え、Shift+クリックが基点からの範囲選択、
 * Ctrl/Cmd+クリックがトグル(基点を移す)になること、Shift+↑↓で範囲を広げてフォーカスが隣のチェックボックスに移ること
 * (修飾キーなしの↑↓や、Shift 以外では何もしないこと)、行を押す操作(pickRow)が同じ規則に乗ること、
 * 基点が選択の解除で忘れられること、scope をまたぐ範囲選択をしないことを検証する。
 * 外部依存なし(最小のチェックボックス一覧を描画して操作する)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRangeSelection, useRangeAnchor, useRangeSelection } from './useRangeSelection'

afterEach(cleanup)

const IDS = ['a', 'b', 'c', 'd', 'e']

function List({
  initial = [],
  onChangeSpy,
  scopeOf,
  isSelectable,
  order = IDS,
}: {
  initial?: string[]
  onChangeSpy?: (next: string[]) => void
  scopeOf?: (id: string) => unknown
  isSelectable?: (id: string) => boolean
  order?: string[]
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  const range = useRangeSelection<string>({
    order,
    selected,
    onChange: (next) => {
      onChangeSpy?.(next)
      setSelected(next)
    },
    scopeOf,
    isSelectable,
  })
  return (
    <div>
      <ul>
        {order.map((id) => (
          <li key={id} data-testid={`row-${id}`} {...range.rowProps(id)}>
            <input type="checkbox" aria-label={id} checked={selected.includes(id)} {...range.checkboxProps(id)} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setSelected([])}>
        全解除
      </button>
      <output aria-label="選択">{selected.join(',')}</output>
    </div>
  )
}

const box = (id: string) => screen.getByRole('checkbox', { name: id })
const selection = () => screen.getByLabelText('選択').textContent

describe('useRangeSelection(クリック)', () => {
  it('修飾キーなしでチェックボックスを押すと、その行が選択に加わり、もう一度押すと外れる', () => {
    render(<List />)
    fireEvent.click(box('b'))
    expect(selection()).toBe('b')
    expect(box('b')).toBeChecked()
    fireEvent.click(box('b'))
    expect(selection()).toBe('')
    expect(box('b')).not.toBeChecked()
  })

  it('Shift+クリックで、直前に押した行から押した行までが選択に加わる', () => {
    render(<List />)
    fireEvent.click(box('b'))
    fireEvent.click(box('d'), { shiftKey: true })
    expect(selection()).toBe('b,c,d')
    expect(box('c')).toBeChecked()
  })

  it('Ctrl+クリックと Cmd+クリックは、その行だけを切り替える(ほかの選択は変わらない)', () => {
    render(<List />)
    fireEvent.click(box('a'))
    fireEvent.click(box('d'), { ctrlKey: true })
    expect(selection()).toBe('a,d')
    fireEvent.click(box('a'), { metaKey: true })
    expect(selection()).toBe('d')
  })

  it('Ctrl+クリックのあとの Shift+クリックは、Ctrl で押した行を基点にした範囲選択になる', () => {
    render(<List />)
    fireEvent.click(box('a'))
    fireEvent.click(box('c'), { ctrlKey: true })
    fireEvent.click(box('e'), { shiftKey: true })
    expect(selection()).toBe('a,c,d,e')
  })

  it('基点がないときの Shift+クリックは、その行だけを選ぶ', () => {
    render(<List />)
    fireEvent.click(box('c'), { shiftKey: true })
    expect(selection()).toBe('c')
  })

  it('Shift+クリックのとき、ブラウザの文字列選択を起こさないよう、押下(mousedown)の既定動作を止める', () => {
    render(<List />)
    const notPrevented = fireEvent.mouseDown(box('b'), { shiftKey: true })
    expect(notPrevented).toBe(false)
    expect(fireEvent.mouseDown(box('b'))).toBe(true)
  })

  it('範囲(scope)が違う行へ Shift+クリックしても、範囲選択にならず、その行だけが選ばれる', () => {
    const scopeOf = (id: string) => (id < 'c' ? 'debit' : 'credit')
    render(<List scopeOf={scopeOf} />)
    fireEvent.click(box('a'))
    fireEvent.click(box('d'), { shiftKey: true })
    expect(selection()).toBe('a,d')
  })

  it('選べない行(isSelectable が false)は、押しても切り替わらず、範囲選択にも含まれない', () => {
    render(<List isSelectable={(id) => id !== 'c'} />)
    fireEvent.click(box('a'))
    fireEvent.click(box('e'), { shiftKey: true })
    expect(selection()).toBe('a,b,d,e')
    fireEvent.click(box('c'))
    expect(selection()).toBe('a,b,d,e')
  })

  it('選択が空になったあとの Shift+クリックは、前の基点を使わず、その行だけを選ぶ(解除すると基点を忘れる)', () => {
    render(<List />)
    fireEvent.click(box('b'))
    fireEvent.click(screen.getByRole('button', { name: '全解除' }))
    fireEvent.click(box('d'), { shiftKey: true })
    expect(selection()).toBe('d')
  })

  it('基点の行が表示から消えていれば、次の Shift+クリックはその行だけを選ぶ', () => {
    const view = render(<List />)
    fireEvent.click(box('b'))
    view.rerender(<List order={['a', 'c', 'd', 'e']} />)
    fireEvent.click(box('d'), { shiftKey: true })
    expect(selection()).toBe('b,d')
  })
})

describe('useRangeSelection(キーボード)', () => {
  it('チェックボックスにフォーカスして Shift+↓ を押すと、その行と1つ下の行が選ばれ、フォーカスが1つ下へ移る', () => {
    render(<List />)
    box('b').focus()
    fireEvent.keyDown(box('b'), { key: 'ArrowDown', shiftKey: true })
    expect(selection()).toBe('b,c')
    expect(box('c')).toHaveFocus()
  })

  it('続けて Shift+↓ を押すと範囲が広がり、Shift+↑ を押すと縮む', () => {
    render(<List />)
    box('a').focus()
    fireEvent.keyDown(box('a'), { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(box('b'), { key: 'ArrowDown', shiftKey: true })
    expect(selection()).toBe('a,b,c')
    fireEvent.keyDown(box('c'), { key: 'ArrowUp', shiftKey: true })
    expect(selection()).toBe('a,b')
    expect(box('b')).toHaveFocus()
  })

  it('Shift+↑↓ では、ページのスクロールを起こさないよう既定動作を止める', () => {
    render(<List />)
    box('a').focus()
    expect(fireEvent.keyDown(box('a'), { key: 'ArrowDown', shiftKey: true })).toBe(false)
  })

  it('Shift を押さない ↑↓ や、↑↓ 以外のキーは、何もせず既定の動作に任せる', () => {
    const onChangeSpy = vi.fn()
    render(<List onChangeSpy={onChangeSpy} />)
    box('a').focus()
    expect(fireEvent.keyDown(box('a'), { key: 'ArrowDown' })).toBe(true)
    expect(fireEvent.keyDown(box('a'), { key: 'a', shiftKey: true })).toBe(true)
    expect(onChangeSpy).not.toHaveBeenCalled()
    expect(box('a')).toHaveFocus()
  })

  it('最後の行で Shift+↓ を押しても、それ以上は動かない', () => {
    render(<List />)
    box('e').focus()
    fireEvent.keyDown(box('e'), { key: 'ArrowDown', shiftKey: true })
    expect(selection()).toBe('e')
    expect(box('e')).toHaveFocus()
  })

  it('キーボードの範囲選択のあとの Shift+クリックも、同じ基点から範囲になる', () => {
    render(<List />)
    box('b').focus()
    fireEvent.keyDown(box('b'), { key: 'ArrowDown', shiftKey: true })
    fireEvent.click(box('e'), { shiftKey: true })
    expect(selection()).toBe('b,c,d,e')
  })
})

describe('useRangeSelection(行を押す操作 pickRow)', () => {
  it('行(チェックボックス以外の場所)を押すと、同じ規則で切り替わり、Shift で範囲選択になる', () => {
    render(<List />)
    fireEvent.click(screen.getByTestId('row-a'))
    expect(selection()).toBe('a')
    fireEvent.click(screen.getByTestId('row-c'), { shiftKey: true })
    expect(selection()).toBe('a,b,c')
    fireEvent.click(screen.getByTestId('row-e'), { ctrlKey: true })
    expect(selection()).toBe('a,b,c,e')
  })

  it('チェックボックスを押したときは、行の押下と二重に切り替わらない', () => {
    const onChangeSpy = vi.fn()
    render(<List onChangeSpy={onChangeSpy} />)
    fireEvent.click(box('a'))
    expect(onChangeSpy).toHaveBeenCalledTimes(1)
    expect(selection()).toBe('a')
  })
})

/**
 * 早期 return のあとで選択対象(表示中の行)が決まる画面向け: 基点の保持(useRangeAnchor、フック)は早期 return より前、
 * ハンドラの組み立て(createRangeSelection、フックではない通常の関数)は選択対象が決まった後に呼べること。
 */
describe('useRangeAnchor + createRangeSelection(早期 return のある画面)', () => {
  function LateList({ ready }: { ready: boolean }) {
    const anchor = useRangeAnchor<string>()
    const [selected, setSelected] = useState<string[]>([])
    if (!ready) return <p>読み込み中</p>
    const range = createRangeSelection(anchor, { order: IDS, selected, onChange: setSelected })
    return (
      <div>
        {IDS.map((id) => (
          <input key={id} type="checkbox" aria-label={id} checked={selected.includes(id)} {...range.checkboxProps(id)} />
        ))}
        <output aria-label="選択">{selected.join(',')}</output>
      </div>
    )
  }

  it('読み込み前後で呼ぶフックの数が変わらず、Shift+クリックの範囲選択と Shift+↓ が使える', () => {
    const view = render(<LateList ready={false} />)
    view.rerender(<LateList ready />)
    fireEvent.click(box('a'))
    fireEvent.click(box('c'), { shiftKey: true })
    expect(selection()).toBe('a,b,c')
    box('c').focus()
    fireEvent.keyDown(box('c'), { key: 'ArrowDown', shiftKey: true })
    expect(selection()).toBe('a,b,c,d')
    expect(box('d')).toHaveFocus()
  })
})

/**
 * Ctrl/Cmd を押したまま行のどこを押してもチェックの操作になる(計画Issue #235 D の追加要望)。
 * 行の中の押せる部品(ボタンなど)の動作より優先して行のチェックを切り替え、入力欄・ダイアログの中・チェックボックス自身は
 * それぞれの操作に任せること、ignore で押しても切り替えない部品を足せること、Ctrl なしの押下は何もしないことを検証する。
 */
describe('useRangeSelection(Ctrl/Cmd+行のどこかを押す ctrlRowProps)', () => {
  function CtrlList({ onOpen, ignore }: { onOpen: (id: string) => void; ignore?: string }) {
    const [selected, setSelected] = useState<string[]>([])
    const range = useRangeSelection<string>({ order: IDS, selected, onChange: setSelected })
    return (
      <div>
        <ul>
          {IDS.map((id) => (
            <li key={id} data-testid={`row-${id}`} {...range.ctrlRowProps(id, ignore === undefined ? undefined : { ignore })}>
              <input type="checkbox" aria-label={id} checked={selected.includes(id)} {...range.checkboxProps(id)} />
              <button type="button" onClick={() => onOpen(id)}>
                開く{id}
              </button>
              <span>メモ{id}</span>
              <input type="text" aria-label={`入力${id}`} />
              <div role="dialog" aria-label={`ダイアログ${id}`}>
                <button type="button">ダイアログ内{id}</button>
              </div>
            </li>
          ))}
        </ul>
        <output aria-label="選択">{selected.join(',')}</output>
      </div>
    )
  }

  it('Ctrl+行の文字部分を押すと、その行のチェックが切り替わる', () => {
    render(<CtrlList onOpen={vi.fn()} />)
    fireEvent.click(screen.getByText('メモb'), { ctrlKey: true })
    expect(selection()).toBe('b')
    fireEvent.click(screen.getByText('メモb'), { ctrlKey: true })
    expect(selection()).toBe('')
  })

  it('Cmd(Mac)+行のどこかを押しても、チェックが切り替わる', () => {
    render(<CtrlList onOpen={vi.fn()} />)
    fireEvent.click(screen.getByText('メモc'), { metaKey: true })
    expect(selection()).toBe('c')
  })

  it('Ctrl+行の中のボタンを押すと、ボタン自身の動作(開くなど)は起きず、行のチェックが切り替わる', () => {
    const onOpen = vi.fn()
    render(<CtrlList onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: '開くd' }), { ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
    expect(selection()).toBe('d')
  })

  it('Ctrl を押さずに行のボタンを押すと、従来どおりボタンの動作だけが起き、チェックは変わらない', () => {
    const onOpen = vi.fn()
    render(<CtrlList onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: '開くd' }))
    expect(onOpen).toHaveBeenCalledWith('d')
    expect(selection()).toBe('')
  })

  it('Ctrl+クリックの連続は、基点を移しながらトグルし、Shift+クリックの範囲選択の基点にもなる', () => {
    render(<CtrlList onOpen={vi.fn()} />)
    fireEvent.click(screen.getByText('メモa'), { ctrlKey: true })
    fireEvent.click(screen.getByText('メモc'), { ctrlKey: true })
    expect(selection()).toBe('a,c')
    fireEvent.click(box('e'), { shiftKey: true })
    expect(selection()).toBe('a,c,d,e')
  })

  it('Ctrl+入力欄・ダイアログの中を押したときは、行のチェックを切り替えない', () => {
    render(<CtrlList onOpen={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('入力b'), { ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'ダイアログ内b' }), { ctrlKey: true })
    expect(selection()).toBe('')
  })

  it('Ctrl+チェックボックス自身を押したときは、二重に切り替わらず、1回だけ切り替わる', () => {
    render(<CtrlList onOpen={vi.fn()} />)
    fireEvent.click(box('b'), { ctrlKey: true })
    expect(selection()).toBe('b')
  })

  it('ignore で指定した部品(例: 開閉ボタン)は、Ctrl を押して押しても、その部品の動作に任せる', () => {
    const onOpen = vi.fn()
    render(<CtrlList onOpen={onOpen} ignore="button" />)
    fireEvent.click(screen.getByRole('button', { name: '開くa' }), { ctrlKey: true })
    expect(onOpen).toHaveBeenCalledWith('a')
    expect(selection()).toBe('')
    fireEvent.click(screen.getByText('メモa'), { ctrlKey: true })
    expect(selection()).toBe('a')
  })
})
