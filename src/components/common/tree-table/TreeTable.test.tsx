// @vitest-environment jsdom
/**
 * ツリー表(TreeTable)のコンポーネントテスト(計画Issue #150)。マスタ用の表で、
 * 区分の見出し・入れ子の行・折りたたみ・複数選択・ドラッグ移動(行の上端・下端で並び替え、
 * グループの中央で中へ、区分の見出しで最上位へ)を持つ。移動の可否は純粋関数で判定済みの
 * 結果だけを onMove で通知し、拒否は onMoveRejected で理由を通知することを検証する。
 * 外部依存なし(科目・取引先・プロジェクトで共通の汎用ノード型だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeTable } from './TreeTable'
import type { TreeTableNode } from './treeTableModel'

afterEach(cleanup)

const node = (
  id: string,
  kind: 'group' | 'leaf',
  category: string,
  parentId: string | null,
  cells: string[] = [],
): TreeTableNode => ({ id, kind, category, parentId, name: id, cells })

const categories = [
  { key: 'expense', name: '費用' },
  { key: 'revenue', name: '収益' },
]

const nodes: TreeTableNode[] = [
  node('food', 'group', 'expense', null),
  node('eat-out', 'leaf', 'expense', 'food', ['現金', '有効']),
  node('misc', 'leaf', 'expense', null, ['現金', '無効']),
  node('salary', 'leaf', 'revenue', null),
]

interface Overrides {
  checkedIds?: readonly string[]
  selectedId?: string | null
  onMove?: (...args: never[]) => void
  onMoveRejected?: (reason: string) => void
  onSelect?: (id: string) => void
  onCheckedChange?: (ids: readonly string[]) => void
}

function renderTable(o: Overrides = {}) {
  const onMove = vi.fn()
  const onMoveRejected = vi.fn()
  const onSelect = vi.fn()
  const onCheckedChange = vi.fn()
  render(
    <TreeTable
      categories={categories}
      nodes={nodes}
      columns={['属性', '状態']}
      checkedIds={o.checkedIds ?? []}
      selectedId={o.selectedId ?? null}
      onSelect={o.onSelect ?? onSelect}
      onCheckedChange={o.onCheckedChange ?? onCheckedChange}
      onMove={(o.onMove as never) ?? onMove}
      onMoveRejected={o.onMoveRejected ?? onMoveRejected}
    />,
  )
  return { onMove, onMoveRejected, onSelect, onCheckedChange }
}

const rowOf = (name: string) => screen.getByRole('button', { name }).closest('tr')!
const categoryRow = (name: string) => screen.getByText(name).closest('tr')!

/** jsdomはレイアウトを持たないため、行の位置と高さ(100px)を与えてドロップ位置を決める。 */
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
  // jsdomのDragEventはclientYを受け取らないため、イベントに直接設定する
  const event = createEvent.dragOver(row)
  Object.defineProperty(event, 'clientY', { value: ratio * 100 })
  fireEvent(row, event)
}

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '' })

describe('TreeTable(表示)', () => {
  it('列見出しと、区分の見出し・グループ・葉の行を表示し、件数を出す', () => {
    renderTable()
    expect(screen.getByRole('columnheader', { name: '名称' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '属性' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '状態' })).toBeInTheDocument()
    expect(categoryRow('費用')).toHaveTextContent('2件')
    expect(rowOf('eat-out')).toHaveTextContent('現金')
    expect(rowOf('eat-out')).toHaveTextContent('有効')
  })

  it('グループの開閉ボタンで配下の行を隠したり出したりできる', () => {
    renderTable()
    const toggle = screen.getByRole('button', { name: 'foodを開閉' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'eat-out' })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'eat-out' })).toBeInTheDocument()
  })

  it('名称を押すと選択を通知し、選択中の行がaria-currentで示される', () => {
    const { onSelect } = renderTable({ selectedId: 'misc' })
    fireEvent.click(screen.getByRole('button', { name: 'eat-out' }))
    expect(onSelect).toHaveBeenCalledWith('eat-out')
    expect(rowOf('misc')).toHaveAttribute('aria-current', 'true')
  })

  it('チェックボックスで複数選択でき、チェック済みの一覧を通知する', () => {
    const { onCheckedChange } = renderTable({ checkedIds: ['misc'] })
    expect(screen.getByRole('checkbox', { name: 'miscを選択' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'eat-outを選択' }))
    expect(onCheckedChange).toHaveBeenCalledWith(['misc', 'eat-out'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'miscを選択' }))
    expect(onCheckedChange).toHaveBeenLastCalledWith([])
  })

  it('区分の見出し行には追加ボタンなどを差し込める', () => {
    render(
      <TreeTable
        categories={categories}
        nodes={nodes}
        columns={[]}
        checkedIds={[]}
        selectedId={null}
        onSelect={() => {}}
        onCheckedChange={() => {}}
        onMove={() => {}}
        renderCategoryActions={(key) => <button type="button">{`${key}に追加`}</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'expenseに追加' })).toBeInTheDocument()
  })
})

describe('TreeTable(ドラッグ移動)', () => {
  it('行はドラッグでき、グループの中央に落とすとその中へ移動する', () => {
    const { onMove } = renderTable()
    const misc = rowOf('misc')
    expect(misc).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(misc, { dataTransfer: dataTransfer() })
    const food = rowOf('food')
    dragOver(food, 0.5)
    fireEvent.drop(food)
    expect(onMove).toHaveBeenCalledTimes(1)
    const [next, info] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'misc').parentId).toBe('food')
    expect(info).toMatchObject({ ids: ['misc'], targetId: 'food', zone: 'inside', expandId: 'food' })
  })

  it('行の下端に落とすと、その行の後ろへ兄弟として並び替える', () => {
    const { onMove } = renderTable()
    fireEvent.dragStart(rowOf('eat-out'), { dataTransfer: dataTransfer() })
    const misc = rowOf('misc')
    dragOver(misc, 0.9)
    fireEvent.drop(misc)
    const [next, info] = onMove.mock.calls[0]
    expect(info.zone).toBe('after')
    expect(next.find((n: TreeTableNode) => n.id === 'eat-out').parentId).toBeNull()
  })

  it('区分の見出しに落とすと、その区分の最上位へ移動する', () => {
    const { onMove } = renderTable()
    fireEvent.dragStart(rowOf('eat-out'), { dataTransfer: dataTransfer() })
    const heading = categoryRow('費用')
    fireEvent.dragOver(heading)
    fireEvent.drop(heading)
    const [next] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'eat-out').parentId).toBeNull()
  })

  it('チェック済みの行をドラッグすると、チェック済みの全行をまとめて移動する', () => {
    const { onMove } = renderTable({ checkedIds: ['eat-out', 'misc'] })
    fireEvent.dragStart(rowOf('misc'), { dataTransfer: dataTransfer() })
    const food = rowOf('food')
    dragOver(food, 0.5)
    fireEvent.drop(food)
    expect(onMove.mock.calls[0][1].ids).toEqual(['eat-out', 'misc'])
  })

  it('チェックしていない行をドラッグしたときは、その1行だけを移動する', () => {
    const { onMove } = renderTable({ checkedIds: ['misc'] })
    fireEvent.dragStart(rowOf('eat-out'), { dataTransfer: dataTransfer() })
    const heading = categoryRow('費用')
    fireEvent.dragOver(heading)
    fireEvent.drop(heading)
    expect(onMove.mock.calls[0][1].ids).toEqual(['eat-out'])
  })

  it('区分をまたぐ移動は拒否し、理由を通知してonMoveは呼ばない', () => {
    const { onMove, onMoveRejected } = renderTable()
    fireEvent.dragStart(rowOf('salary'), { dataTransfer: dataTransfer() })
    const food = rowOf('food')
    dragOver(food, 0.5)
    fireEvent.drop(food)
    expect(onMove).not.toHaveBeenCalled()
    expect(onMoveRejected).toHaveBeenCalledWith('区分をまたいで移動できません')
  })

  it('ドラッグ中は落とす位置を行のdata-drop-zoneで示し、終了すると消える', () => {
    renderTable()
    fireEvent.dragStart(rowOf('misc'), { dataTransfer: dataTransfer() })
    const food = rowOf('food')
    dragOver(food, 0.1)
    expect(food).toHaveAttribute('data-drop-zone', 'before')
    dragOver(food, 0.5)
    expect(food).toHaveAttribute('data-drop-zone', 'inside')
    fireEvent.dragEnd(rowOf('misc'))
    expect(food).not.toHaveAttribute('data-drop-zone')
  })

  it('ドラッグを始めずに落としても何も起きない', () => {
    const { onMove, onMoveRejected } = renderTable()
    const food = rowOf('food')
    dragOver(food, 0.5)
    fireEvent.drop(food)
    expect(onMove).not.toHaveBeenCalled()
    expect(onMoveRejected).not.toHaveBeenCalled()
  })

  it('表全体は列見出し付きのtableとして読み上げられる', () => {
    renderTable()
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBeGreaterThan(4)
  })
})

describe('TreeTable(キーボードでの移動)', () => {
  const destinationSelect = () => screen.getByRole('combobox', { name: '選択した行の移動先' })

  it('行をチェックすると「移動先を選ぶ」欄が出て、チェックしていないときは出ない', () => {
    renderTable()
    expect(screen.queryByRole('combobox', { name: '選択した行の移動先' })).toBeNull()
    cleanup()
    renderTable({ checkedIds: ['misc'] })
    expect(destinationSelect()).toBeInTheDocument()
    expect(screen.getByText('1件を移動')).toBeInTheDocument()
  })

  it('移動先には、同じ区分の最上位とグループが並び、移動する行とその配下は含まれない', () => {
    renderTable({ checkedIds: ['food'] })
    const labels = within(destinationSelect())
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(labels).toEqual(['移動先を選ぶ', '費用の最上位'])
  })

  it('グループを選ぶと、チェックした行がそのグループの中へ移動する', () => {
    const { onMove } = renderTable({ checkedIds: ['misc'] })
    fireEvent.change(destinationSelect(), { target: { value: 'food' } })
    expect(onMove).toHaveBeenCalledTimes(1)
    const [next, info] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'misc').parentId).toBe('food')
    expect(info).toMatchObject({ ids: ['misc'], targetId: 'food', zone: 'inside', expandId: 'food' })
  })

  it('区分の最上位を選ぶと、チェックした複数の行がまとめて最上位へ移動する', () => {
    const { onMove } = renderTable({ checkedIds: ['eat-out'] })
    fireEvent.change(destinationSelect(), { target: { value: 'cat:expense' } })
    const [next, info] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'eat-out').parentId).toBeNull()
    expect(info.ids).toEqual(['eat-out'])
  })

  it('複数の区分にまたがってチェックしているときは、移動先の欄を出さない', () => {
    renderTable({ checkedIds: ['misc', 'salary'] })
    expect(screen.queryByRole('combobox', { name: '選択した行の移動先' })).toBeNull()
  })

  it('「移動先を選ぶ」のまま(空の選択)では何も起きない', () => {
    const { onMove, onMoveRejected } = renderTable({ checkedIds: ['misc'] })
    fireEvent.change(destinationSelect(), { target: { value: '' } })
    expect(onMove).not.toHaveBeenCalled()
    expect(onMoveRejected).not.toHaveBeenCalled()
  })

  it('チェックボックス・名称・開閉・移動先の欄のすべてにTabで到達できる(tabindex=-1にしない)', () => {
    renderTable({ checkedIds: ['misc'] })
    const focusables = [
      screen.getByRole('checkbox', { name: 'miscを選択' }),
      screen.getByRole('button', { name: 'misc' }),
      screen.getByRole('button', { name: 'foodを開閉' }),
      destinationSelect(),
    ]
    for (const element of focusables) expect(element).not.toHaveAttribute('tabindex', '-1')
  })
})
