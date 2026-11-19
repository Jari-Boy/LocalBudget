// @vitest-environment jsdom
/**
 * ツリー表(TreeTable)の、葉の行の名称の左に差し込む操作(renderLeafLeading、計画Issue #231 フェーズ4。マスタ画面のお気に入りの★に使う)の
 * コンポーネントテスト。葉の行(グループの行ではない)だけで呼ばれ、渡した部品が名称の左(名称のボタンより前)に出ること、
 * 渡さないときは何も出ない(従来の表のまま)こと、差し込んだボタンを押しても行の選択・ドラッグの操作を起こさないことを検証する。
 * 外部依存なし(汎用のノード型だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeTable } from './TreeTable'
import type { TreeTableNode } from './treeTableModel'

afterEach(cleanup)

const node = (id: string, kind: 'group' | 'leaf', parentId: string | null): TreeTableNode => ({
  id,
  kind,
  category: 'expense',
  parentId,
  name: id,
  cells: [],
})

const nodes: TreeTableNode[] = [node('food', 'group', null), node('eat-out', 'leaf', 'food'), node('misc', 'leaf', null)]

function setup(renderLeafLeading?: (node: TreeTableNode) => React.ReactNode, onSelect = vi.fn()) {
  render(
    <TreeTable
      categories={[{ key: 'expense', name: '費用' }]}
      nodes={nodes}
      columns={[]}
      checkedIds={[]}
      selectedId={null}
      onSelect={onSelect}
      onCheckedChange={() => {}}
      onMove={() => {}}
      renderLeafLeading={renderLeafLeading}
    />,
  )
  return { onSelect }
}

describe('TreeTable: renderLeafLeading', () => {
  it('葉の行の名称の左(名称のボタンより前)に、渡した部品を出す。グループの行には出さない', () => {
    setup((n) => (
      <button type="button" aria-label={`${n.name}の★`}>
        ★
      </button>
    ))

    expect(screen.getByRole('button', { name: 'eat-outの★' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'miscの★' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'foodの★' })).not.toBeInTheDocument()
    const star = screen.getByRole('button', { name: 'miscの★' })
    const name = screen.getByRole('button', { name: 'misc' })
    expect(star.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('渡さないときは、何も足さない(従来の表のまま)', () => {
    setup()

    const row = screen.getByRole('button', { name: 'misc' }).closest('tr')!
    expect(within(row).getAllByRole('button')).toHaveLength(1)
  })

  it('差し込んだボタンを押しても、行の選択(onSelect)は起きない', () => {
    const { onSelect } = setup((n) => (
      <button type="button" aria-label={`${n.name}の★`}>
        ★
      </button>
    ))

    fireEvent.click(screen.getByRole('button', { name: 'miscの★' }))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
