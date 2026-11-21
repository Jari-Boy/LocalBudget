// @vitest-environment jsdom
/**
 * ツリー表(TreeTable)の複数ドラッグ&ドロップ移動と、グループのチェックの配下への連動のコンポーネントテスト(計画Issue #235 E)。
 * チェックした行をドラッグすると、チェックした全行(グループと配下を同時にチェックしたときは、グループ1件として配下ごと)を移すこと、
 * チェックしていない行をつかんだときはその1行だけを移すこと、区分違い・自分の配下への移動は1件でも不可なら全件を移さず理由を通知すること、
 * ドラッグ中に「N件を移動」の表示が付くこと、移す行が薄く表示されること、単一ノードのドラッグが従来どおり動くことを検証する。
 * グループにチェックを付けると配下(折りたたまれた行も)にチェックが連動し、配下を一部外すとグループが外れることも検証する。
 * 外部依存なし(汎用ノード型だけを渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeTable } from './TreeTable'
import type { TreeTableMoveInfo } from './TreeTable'
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

// 費用: food{eat-out, snack} / living{rent} / misc ・ 収益: salary
const nodes: TreeTableNode[] = [
  node('food', 'group', 'expense', null),
  node('eat-out', 'leaf', 'expense', 'food'),
  node('snack', 'leaf', 'expense', 'food'),
  node('living', 'group', 'expense', null),
  node('rent', 'leaf', 'expense', 'living'),
  node('misc', 'leaf', 'expense', null),
  node('salary', 'leaf', 'revenue', null),
]

interface Spies {
  onMove: ReturnType<typeof vi.fn>
  onMoveRejected: ReturnType<typeof vi.fn>
}

function Harness({ spies, initialChecked = [] }: { spies: Spies; initialChecked?: string[] }) {
  const [checked, setChecked] = useState<readonly string[]>(initialChecked)
  return (
    <TreeTable
      categories={categories}
      nodes={nodes}
      columns={[]}
      checkedIds={checked}
      selectedId={null}
      onSelect={vi.fn()}
      onCheckedChange={setChecked}
      onMove={spies.onMove as never}
      onMoveRejected={spies.onMoveRejected as never}
    />
  )
}

function setup(initialChecked: string[] = []) {
  const spies: Spies = { onMove: vi.fn(), onMoveRejected: vi.fn() }
  render(<Harness spies={spies} initialChecked={initialChecked} />)
  return spies
}

const rowOf = (name: string) => screen.getByRole('button', { name }).closest('tr') as HTMLElement
const box = (name: string) => screen.getByRole('checkbox', { name: `${name}を選択` }) as HTMLInputElement

/** jsdomはレイアウトを持たないため、行の位置と高さ(100px)を与えてドロップ位置を決める */
function dragOver(row: HTMLElement, ratio: number) {
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    height: 100,
    left: 0,
    right: 0,
    bottom: 100,
    width: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  const event = createEvent.dragOver(row)
  Object.defineProperty(event, 'clientY', { value: ratio * 100 })
  fireEvent(row, event)
}

function makeDataTransfer() {
  return { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' }
}

/** つかんだ行を、移動先のグループの中央(中へ)に落とす */
function dragTo(from: string, to: string, dataTransfer = makeDataTransfer()) {
  fireEvent.dragStart(rowOf(from), { dataTransfer })
  dragOver(rowOf(to), 0.5)
  fireEvent.drop(rowOf(to))
  return dataTransfer
}

const movedParents = (call: unknown[]) => new Map((call[0] as TreeTableNode[]).map((n) => [n.id, n.parentId]))

describe('TreeTable(グループのチェックの配下への連動)', () => {
  it('グループにチェックを付けると、配下の行すべてにチェックが付く', () => {
    setup()
    fireEvent.click(box('food'))
    expect([box('food'), box('eat-out'), box('snack')].map((b) => b.checked)).toEqual([true, true, true])
    expect(box('living').checked).toBe(false)
  })

  it('グループのチェックを外すと、配下のチェックも外れる', () => {
    setup(['food', 'eat-out', 'snack'])
    fireEvent.click(box('food'))
    expect([box('food'), box('eat-out'), box('snack')].map((b) => b.checked)).toEqual([false, false, false])
  })

  it('配下の一部のチェックを外すと、グループのチェックも外れる(残りの配下は残る)', () => {
    setup(['food', 'eat-out', 'snack'])
    fireEvent.click(box('eat-out'))
    expect([box('food'), box('eat-out'), box('snack')].map((b) => b.checked)).toEqual([false, false, true])
  })

  it('配下がすべてチェックされると、グループにもチェックが付く', () => {
    setup()
    fireEvent.click(box('eat-out'))
    expect(box('food').checked).toBe(false)
    fireEvent.click(box('snack'))
    expect(box('food').checked).toBe(true)
  })

  it('折りたたまれて隠れている配下にも、グループのチェックが連動する', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'foodを開閉' }))
    fireEvent.click(box('food'))
    fireEvent.click(screen.getByRole('button', { name: 'foodを開閉' }))
    expect([box('eat-out'), box('snack')].map((b) => b.checked)).toEqual([true, true])
  })

  it('Shift+クリックの範囲選択にグループが含まれると、その配下も連動してチェックされる', () => {
    setup()
    fireEvent.click(box('misc'))
    fireEvent.click(box('food'), { shiftKey: true })
    const ids = ['food', 'eat-out', 'snack', 'living', 'rent', 'misc']
    expect(ids.map((id) => box(id).checked)).toEqual([true, true, true, true, true, true])
  })

  it('「すべて選択」で、すべての行(グループと配下)にチェックが付く', () => {
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))
    expect(['food', 'eat-out', 'snack', 'living', 'rent', 'misc', 'salary'].every((id) => box(id).checked)).toBe(true)
  })
})

describe('TreeTable(絞り込み中のグループのチェックの連動、計画Issue #235 E)', () => {
  /** 検索などで nodes を絞り込んで渡す画面を再現する: snack(food の配下)は隠れているが、cascadeNodes には全ノードを渡す */
  function Filtered({ withCascadeNodes }: { withCascadeNodes: boolean }) {
    const [checked, setChecked] = useState<readonly string[]>([])
    const shown = nodes.filter((n) => n.id !== 'snack')
    return (
      <>
        <TreeTable
          categories={categories}
          nodes={shown}
          cascadeNodes={withCascadeNodes ? nodes : undefined}
          columns={[]}
          checkedIds={checked}
          selectedId={null}
          onSelect={vi.fn()}
          onCheckedChange={setChecked}
          onMove={vi.fn()}
        />
        <output aria-label="チェック済み">{checked.join(',')}</output>
      </>
    )
  }
  const checkedList = () => (screen.getByLabelText('チェック済み').textContent ?? '').split(',').filter(Boolean).sort()

  it('絞り込みで隠れている配下も、グループのチェックに連動してチェックされる(連動は絞り込み前の全ノードで計算する)', () => {
    render(<Filtered withCascadeNodes />)
    fireEvent.click(box('food'))
    expect(checkedList()).toEqual(['eat-out', 'food', 'snack'])
  })

  it('絞り込み中の見えている配下だけをチェックしても、隠れた配下がそろっていないので、グループにはチェックが付かない', () => {
    render(<Filtered withCascadeNodes />)
    fireEvent.click(box('eat-out'))
    expect(checkedList()).toEqual(['eat-out'])
  })

  it('cascadeNodes を渡さないときは、表示している nodes で連動を計算する(従来どおり)', () => {
    render(<Filtered withCascadeNodes={false} />)
    fireEvent.click(box('food'))
    expect(checkedList()).toEqual(['eat-out', 'food'])
  })
})

describe('TreeTable(複数ドラッグ&ドロップ移動)', () => {
  it('チェックした複数の行(グループとその配下をまとめてチェック+別の行)をドラッグすると、グループは配下ごと、別の行と一緒に移る', () => {
    const spies = setup(['food', 'eat-out', 'snack', 'misc'])
    dragTo('misc', 'living')
    expect(spies.onMove).toHaveBeenCalledTimes(1)
    const parents = movedParents(spies.onMove.mock.calls[0])
    expect(parents.get('food')).toBe('living')
    expect(parents.get('misc')).toBe('living')
    expect(parents.get('eat-out')).toBe('food')
    expect(parents.get('snack')).toBe('food')
    const info = spies.onMove.mock.calls[0][1] as TreeTableMoveInfo
    expect(info.ids).toEqual(['food', 'misc'])
    expect(info.targetId).toBe('living')
    expect(info.expandId).toBe('living')
  })

  it('チェックした行のうち、どの行をつかんでも、チェックした全行が移る', () => {
    const spies = setup(['eat-out', 'misc'])
    dragTo('eat-out', 'living')
    const parents = movedParents(spies.onMove.mock.calls[0])
    expect(parents.get('eat-out')).toBe('living')
    expect(parents.get('misc')).toBe('living')
  })

  it('チェックしていない行をつかんだときは、チェックした行は移さず、つかんだ1行だけを移す(チェックは変わらない)', () => {
    const spies = setup(['eat-out'])
    dragTo('misc', 'living')
    const parents = movedParents(spies.onMove.mock.calls[0])
    expect(parents.get('misc')).toBe('living')
    expect(parents.get('eat-out')).toBe('food')
    expect((spies.onMove.mock.calls[0][1] as TreeTableMoveInfo).ids).toEqual(['misc'])
    expect(box('eat-out').checked).toBe(true)
  })

  it('チェックがないときの単一ノードのドラッグは、従来どおりその1行が移る', () => {
    const spies = setup()
    dragTo('misc', 'living')
    expect((spies.onMove.mock.calls[0][1] as TreeTableMoveInfo).ids).toEqual(['misc'])
    expect(movedParents(spies.onMove.mock.calls[0]).get('misc')).toBe('living')
  })

  it('チェックした行に区分(費用・収益)の違う行が1件でも混ざっていたら、全件を移さず、理由を通知する', () => {
    const spies = setup(['misc', 'salary'])
    dragTo('misc', 'living')
    expect(spies.onMove).not.toHaveBeenCalled()
    expect(spies.onMoveRejected).toHaveBeenCalledWith('区分をまたいで移動できません')
  })

  it('チェックしたグループを、チェックしたグループ自身の配下へ落とすと、全件を移さず、理由を通知する', () => {
    const spies = setup(['food', 'eat-out', 'snack', 'living', 'rent'])
    // food と living の両方をチェックしている。food をつかんで food 自身の中へ落とす(自分自身の配下)
    fireEvent.dragStart(rowOf('food'), { dataTransfer: makeDataTransfer() })
    dragOver(rowOf('food'), 0.5)
    fireEvent.drop(rowOf('food'))
    expect(spies.onMove).not.toHaveBeenCalled()
    expect(spies.onMoveRejected).toHaveBeenCalledWith('自分自身の配下には移動できません')
  })

  it('チェックした複数の行を、区分の見出しへ落として、その区分の最上位へ移すこともできる', () => {
    const spies = setup(['eat-out', 'rent'])
    fireEvent.dragStart(rowOf('eat-out'), { dataTransfer: makeDataTransfer() })
    const category = screen.getByText('費用').closest('tr') as HTMLElement
    fireEvent.dragOver(category)
    fireEvent.drop(category)
    const parents = movedParents(spies.onMove.mock.calls[0])
    expect(parents.get('eat-out')).toBeNull()
    expect(parents.get('rent')).toBeNull()
  })
})

describe('TreeTable(ドラッグ中の表示)', () => {
  it('複数の行を移すときは、ドラッグ中に「N件を移動」の表示(件数は移す葉の数)が付く', () => {
    setup(['food', 'eat-out', 'snack', 'misc'])
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(rowOf('misc'), { dataTransfer })
    expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1)
    const image = dataTransfer.setDragImage.mock.calls[0][0] as HTMLElement
    expect(image.textContent).toBe('3件を移動')
  })

  it('1件だけを移すときは、「N件を移動」の表示は付けない(ブラウザの標準の表示のまま)', () => {
    setup(['eat-out'])
    const dataTransfer = makeDataTransfer()
    fireEvent.dragStart(rowOf('misc'), { dataTransfer })
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled()
  })

  it('ドラッグ中は、移す行(グループなら配下も)が薄く表示され、終わると元に戻る', async () => {
    setup(['food', 'eat-out', 'snack', 'misc'])
    fireEvent.dragStart(rowOf('misc'), { dataTransfer: makeDataTransfer() })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    for (const name of ['food', 'eat-out', 'snack', 'misc']) expect(rowOf(name)).toHaveClass('tree-table__row--dragging')
    expect(rowOf('living')).not.toHaveClass('tree-table__row--dragging')
    fireEvent.dragEnd(rowOf('misc'))
    expect(rowOf('misc')).not.toHaveClass('tree-table__row--dragging')
  })

  it('setDragImage を持たない環境(古いブラウザ・テスト)でも、ドラッグは動く', () => {
    const spies = setup(['eat-out', 'misc'])
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(rowOf('misc'), { dataTransfer })
    dragOver(rowOf('living'), 0.5)
    fireEvent.drop(rowOf('living'))
    expect(spies.onMove).toHaveBeenCalledTimes(1)
  })
})
