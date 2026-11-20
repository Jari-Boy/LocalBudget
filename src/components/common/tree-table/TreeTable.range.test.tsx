// @vitest-environment jsdom
/**
 * ツリー表(TreeTable)の範囲選択・トグル選択のコンポーネントテスト(計画Issue #235 D)。
 * 行のチェックボックスを Shift+クリックすると、基点から表示中の行までを範囲選択できること(折りたたみで隠れた行は含まれない、
 * 区分をまたいでもよい)、Ctrl/Cmd+クリックでその行だけを切り替えられること、Shift+↑↓でフォーカスのあるチェックが表示中の
 * 次の行へ移りながら範囲が広がること、修飾キーなしのクリックは従来どおり1行の切り替えであることを検証する。
 * 外部依存なし(汎用ノード型だけを渡し、チェックの状態を持つ小さな親を使う)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeTable } from './TreeTable'
import type { TreeTableNode } from './treeTableModel'

afterEach(cleanup)

const node = (id: string, kind: 'group' | 'leaf', category: string, parentId: string | null): TreeTableNode => ({
  id,
  kind,
  category,
  parentId,
  name: id,
  cells: [],
})

const categories = [
  { key: 'expense', name: '費用' },
  { key: 'revenue', name: '収益' },
]

// 表示順: food, eat-out, snack, misc, salary(収益)
const nodes: TreeTableNode[] = [
  node('food', 'group', 'expense', null),
  node('eat-out', 'leaf', 'expense', 'food'),
  node('snack', 'leaf', 'expense', 'food'),
  node('misc', 'leaf', 'expense', null),
  node('salary', 'leaf', 'revenue', null),
]

function Stateful() {
  const [checked, setChecked] = useState<readonly string[]>([])
  return (
    <TreeTable
      categories={categories}
      nodes={nodes}
      columns={[]}
      checkedIds={checked}
      selectedId={null}
      onSelect={vi.fn()}
      onCheckedChange={setChecked}
      onMove={vi.fn()}
    />
  )
}

const box = (id: string) => screen.getByRole('checkbox', { name: `${id}を選択` })
const checkedIds = () =>
  ['food', 'eat-out', 'snack', 'misc', 'salary'].filter((id) => {
    const element = screen.queryByRole('checkbox', { name: `${id}を選択` }) as HTMLInputElement | null
    return element?.checked === true
  })

describe('TreeTable(範囲選択・トグル選択)', () => {
  it('修飾キーなしのクリックは、従来どおりその行だけを切り替える', () => {
    render(<Stateful />)
    fireEvent.click(box('misc'))
    expect(checkedIds()).toEqual(['misc'])
    fireEvent.click(box('misc'))
    expect(checkedIds()).toEqual([])
  })

  it('Shift+クリックで、基点の行から押した行までの表示中の行が選択に加わる', () => {
    render(<Stateful />)
    fireEvent.click(box('eat-out'))
    fireEvent.click(box('misc'), { shiftKey: true })
    expect(checkedIds()).toEqual(['eat-out', 'snack', 'misc'])
  })

  it('上の行へ向けての Shift+クリックも、同じ範囲になる', () => {
    render(<Stateful />)
    fireEvent.click(box('misc'))
    fireEvent.click(box('food'), { shiftKey: true })
    expect(checkedIds()).toEqual(['food', 'eat-out', 'snack', 'misc'])
  })

  it('区分(費用・収益)をまたぐ範囲も選べる', () => {
    render(<Stateful />)
    fireEvent.click(box('misc'))
    fireEvent.click(box('salary'), { shiftKey: true })
    expect(checkedIds()).toEqual(['misc', 'salary'])
  })

  it('折りたたまれて隠れている行は、範囲選択に含まれない(表示中の行だけが対象)', () => {
    render(<Stateful />)
    fireEvent.click(screen.getByRole('button', { name: 'foodを開閉' }))
    fireEvent.click(box('food'))
    fireEvent.click(box('misc'), { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'foodを開閉' }))
    expect(checkedIds()).toEqual(['food', 'misc'])
  })

  it('Ctrl+クリックと Cmd+クリックは、ほかの選択を保ったまま、その行だけを切り替える', () => {
    render(<Stateful />)
    fireEvent.click(box('food'))
    fireEvent.click(box('misc'), { ctrlKey: true })
    expect(checkedIds()).toEqual(['food', 'misc'])
    fireEvent.click(box('food'), { metaKey: true })
    expect(checkedIds()).toEqual(['misc'])
  })

  it('Shift+↓ で、チェックにフォーカスのある行から次の表示中の行までが選ばれ、フォーカスがそこへ移る', () => {
    render(<Stateful />)
    box('snack').focus()
    fireEvent.keyDown(box('snack'), { key: 'ArrowDown', shiftKey: true })
    expect(checkedIds()).toEqual(['snack', 'misc'])
    expect(box('misc')).toHaveFocus()
  })

  it('折りたたまれて隠れている行は、Shift+↓ で飛ばされる', () => {
    render(<Stateful />)
    fireEvent.click(screen.getByRole('button', { name: 'foodを開閉' }))
    box('food').focus()
    fireEvent.keyDown(box('food'), { key: 'ArrowDown', shiftKey: true })
    expect(checkedIds()).toEqual(['food', 'misc'])
    expect(box('misc')).toHaveFocus()
  })

  it('ヘッダーの「すべて選択」は、これまでどおり表示中の全行を選び、もう一度押すと解除する', () => {
    render(<Stateful />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))
    expect(checkedIds()).toEqual(['food', 'eat-out', 'snack', 'misc', 'salary'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))
    expect(checkedIds()).toEqual([])
  })
})
