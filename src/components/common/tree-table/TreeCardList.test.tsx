// @vitest-environment jsdom
/**
 * カード型のツリー一覧(TreeCardList、計画Issue #201)のコンポーネントテスト。仕訳一覧(JournalResultList)と
 * 同じ見た目のカード(名称・右に金額・下に補足・タグ)で、区分の見出し・入れ子のグループ・折りたたみ・選択・
 * ドラッグ移動(行の上端・下端で並び替え、グループの中央で中へ、区分の見出しで最上位へ)を持つ。
 * 移動の可否は純粋関数で判定済みの結果だけを onMove で通知し、拒否は onMoveRejected で理由を通知することを検証する。
 * 外部依存なし(汎用ノード型だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeCardList } from './TreeCardList'
import type { TreeTableNode } from './treeTableModel'

afterEach(cleanup)

const node = (id: string, kind: 'group' | 'leaf', parentId: string | null, cells: string[] = []): TreeTableNode => ({
  id,
  kind,
  category: 'tpl',
  parentId,
  name: id,
  cells,
})

const categories = [{ key: 'tpl', name: 'すべてのテンプレート' }]

const nodes: TreeTableNode[] = [
  node('food', 'group', null),
  node('lunch', 'leaf', 'food', ['食費 / 現金', '起票時に入力', '有効']),
  node('gym', 'leaf', null, ['会費 / 普通預金', '￥8,800', '無効']),
]

function renderList(selectedId: string | null = null) {
  const onMove = vi.fn()
  const onMoveRejected = vi.fn()
  const onSelect = vi.fn()
  render(
    <TreeCardList
      categories={categories}
      nodes={nodes}
      selectedId={selectedId}
      onSelect={onSelect}
      onMove={onMove}
      onMoveRejected={onMoveRejected}
      renderCard={(n) => ({ sub: n.cells[0], amount: n.cells[1], tag: n.cells[2] === '無効' ? '無効' : undefined })}
    />,
  )
  return { onMove, onMoveRejected, onSelect }
}

const itemOf = (name: string) => screen.getByRole('button', { name }).closest('li')!

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
  const event = createEvent.dragOver(row)
  Object.defineProperty(event, 'clientY', { value: ratio * 100 })
  fireEvent(row, event)
}

const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: '' })

describe('TreeCardList(表示)', () => {
  it('区分の見出しに件数を出し、葉のカードに名称・右に金額・下に補足を出す', () => {
    renderList()

    expect(screen.getByText('すべてのテンプレート').closest('li')).toHaveTextContent('2件')
    const lunch = itemOf('lunch')
    expect(lunch).toHaveTextContent('lunch')
    expect(lunch).toHaveTextContent('起票時に入力')
    expect(lunch).toHaveTextContent('食費 / 現金')
  })

  it('グループの見出しに配下の件数を出し、タグ(無効など)をカードに出す', () => {
    renderList()

    expect(itemOf('food')).toHaveTextContent('1件')
    expect(itemOf('gym')).toHaveTextContent('無効')
    expect(itemOf('lunch')).not.toHaveTextContent('無効')
  })

  it('仕訳一覧と同じカードのクラス(journal-result-list)を使う', () => {
    renderList()

    expect(screen.getByRole('button', { name: 'gym' })).toHaveClass('journal-result-list__row')
  })

  it('グループの開閉ボタンで配下のカードを隠したり出したりできる', () => {
    renderList()
    const toggle = screen.getByRole('button', { name: 'foodを開閉' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'lunch' })).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'lunch' })).toBeInTheDocument()
  })
})

describe('TreeCardList(選択)', () => {
  it('カードを押すとonSelectにidを渡し、選択中のカードはaria-currentと選択の見た目になる', () => {
    const { onSelect } = renderList('gym')

    fireEvent.click(screen.getByRole('button', { name: 'lunch' }))

    expect(onSelect).toHaveBeenCalledWith('lunch')
    expect(screen.getByRole('button', { name: 'gym' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'gym' })).toHaveClass('journal-result-list__row--selected')
  })

  it('グループの名前を押してもonSelectにグループのidを渡す', () => {
    const { onSelect } = renderList()

    fireEvent.click(screen.getByRole('button', { name: 'food' }))

    expect(onSelect).toHaveBeenCalledWith('food')
  })
})

describe('TreeCardList(ドラッグ移動)', () => {
  it('カードはドラッグでき、グループの中央に落とすとその中へ移動する', () => {
    const { onMove } = renderList()
    const gym = itemOf('gym')
    expect(gym).toHaveAttribute('draggable', 'true')

    fireEvent.dragStart(gym, { dataTransfer: dataTransfer() })
    const food = itemOf('food')
    dragOver(food, 0.5)
    fireEvent.drop(food)

    expect(onMove).toHaveBeenCalledTimes(1)
    const [next, info] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'gym').parentId).toBe('food')
    expect(info).toMatchObject({ ids: ['gym'], targetId: 'food', zone: 'inside', expandId: 'food' })
  })

  it('カードの下端に落とすと、そのカードの後ろへ並び替える', () => {
    const { onMove } = renderList()

    fireEvent.dragStart(itemOf('lunch'), { dataTransfer: dataTransfer() })
    const gym = itemOf('gym')
    dragOver(gym, 0.9)
    fireEvent.drop(gym)

    const [, info] = onMove.mock.calls[0]
    expect(info).toMatchObject({ ids: ['lunch'], targetId: 'gym', zone: 'after' })
  })

  it('区分の見出しに落とすと、最上位へ移動する', () => {
    const { onMove } = renderList()

    fireEvent.dragStart(itemOf('lunch'), { dataTransfer: dataTransfer() })
    const heading = screen.getByText('すべてのテンプレート').closest('li')!
    fireEvent.dragOver(heading)
    fireEvent.drop(heading)

    const [next] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'lunch').parentId).toBeNull()
  })

  it('自分の配下へのグループの移動は拒否し、理由をonMoveRejectedに通知する', () => {
    const { onMove, onMoveRejected } = renderList()

    fireEvent.dragStart(itemOf('food'), { dataTransfer: dataTransfer() })
    const lunch = itemOf('lunch')
    dragOver(lunch, 0.9)
    fireEvent.drop(lunch)

    expect(onMove).not.toHaveBeenCalled()
    expect(onMoveRejected).toHaveBeenCalledTimes(1)
  })
})
