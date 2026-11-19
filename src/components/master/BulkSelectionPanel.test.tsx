// @vitest-environment jsdom
/**
 * BulkSelectionPanel(計画Issue #97)のコンポーネントテスト。
 * マスタ画面で2件以上チェックしたときに右側へ出る「一括操作」パネル: 選択件数と名称の一覧、
 * チェックした行の「グループへ移動」(同じ区分の最上位・グループを移動先に選ぶ。判定は
 * resolveTreeMove)、選択の解除、固有の操作(統合など)を差し込む場所を検証する。
 * 外部依存なし(汎用のツリーノードだけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { BulkSelectionPanel } from './BulkSelectionPanel'

afterEach(cleanup)

const node = (
  id: string,
  kind: 'group' | 'leaf',
  category: string,
  parentId: string | null,
): TreeTableNode => ({ id, kind, category, parentId, name: id, cells: [] })

const categories = [
  { key: 'expense', name: '費用' },
  { key: 'revenue', name: '収益' },
]
const nodes: TreeTableNode[] = [
  node('food', 'group', 'expense', null),
  node('eat-out', 'leaf', 'expense', 'food'),
  node('misc', 'leaf', 'expense', null),
  node('other', 'leaf', 'expense', null),
  node('salary', 'leaf', 'revenue', null),
]

function renderPanel(checkedIds: string[], children?: ReactNode) {
  const onMove = vi.fn()
  const onMoveRejected = vi.fn()
  const onClear = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <BulkSelectionPanel
        nodes={nodes}
        categories={categories}
        checkedIds={checkedIds}
        busy={false}
        onMove={onMove}
        onMoveRejected={onMoveRejected}
        onClear={onClear}
      >
        {children}
      </BulkSelectionPanel>
    </I18nextProvider>,
  )
  return { onMove, onMoveRejected, onClear }
}

const destination = () => screen.getByRole('button', { name: /^移動先/ })

/** 移動先の選択欄(共通の選択欄)を開き、検索で絞ってから選ぶ */
function chooseDestination(name: string) {
  fireEvent.click(destination())
  const dialog = within(screen.getByRole('dialog', { name: '移動先' }))
  fireEvent.change(dialog.getByRole('searchbox'), { target: { value: name } })
  fireEvent.click(dialog.getByRole('button', { name }))
}

describe('BulkSelectionPanel', () => {
  it('選択件数と、選んだ行の名称の一覧が表示される', () => {
    renderPanel(['misc', 'other'])
    const panel = within(screen.getByRole('region', { name: '一括操作' }))
    expect(panel.getByText('2件を選択中')).toBeInTheDocument()
    expect(panel.getByText('misc、other')).toBeInTheDocument()
  })

  it('移動先には、同じ区分の最上位とグループが並び、移動する行とその配下は含まれない', () => {
    renderPanel(['food', 'misc'])
    fireEvent.click(destination())
    const dialog = within(screen.getByRole('dialog', { name: '移動先' }))
    expect(dialog.getByRole('button', { name: '費用の最上位' })).toBeInTheDocument()
    fireEvent.change(dialog.getByRole('searchbox'), { target: { value: 'food' } })
    expect(dialog.queryByRole('button', { name: 'food' })).not.toBeInTheDocument()
  })

  it('グループを選ぶと、チェックした行がそのグループの中へ移動する', () => {
    const { onMove } = renderPanel(['misc', 'other'])
    chooseDestination('food')
    const [next, info] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'misc').parentId).toBe('food')
    expect(next.find((n: TreeTableNode) => n.id === 'other').parentId).toBe('food')
    expect(info).toMatchObject({ ids: ['misc', 'other'], targetId: 'food', zone: 'inside' })
  })

  it('区分の最上位を選ぶと、まとめて最上位へ移動する', () => {
    const { onMove } = renderPanel(['eat-out', 'misc'])
    chooseDestination('費用の最上位')
    const [next] = onMove.mock.calls[0]
    expect(next.find((n: TreeTableNode) => n.id === 'eat-out').parentId).toBeNull()
  })

  it('複数の区分にまたがってチェックしているときは、移動先の欄を出さず理由を示す', () => {
    renderPanel(['misc', 'salary'])
    expect(screen.queryByRole('button', { name: /^移動先/ })).toBeNull()
    expect(screen.getByText(/区分をまたいで移動できません/)).toBeInTheDocument()
  })

  it('「選択を解除」で onClear が呼ばれ、固有の操作(children)が表示される', () => {
    const { onClear } = renderPanel(['misc', 'other'], <p>統合の欄</p>)
    expect(screen.getByText('統合の欄')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '選択を解除' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('「選択を解除」は固有の操作(統合など)と区切り線で分けた領域に置かれ、誤って近くの操作を押しにくい', () => {
    renderPanel(['misc', 'other'], <button type="button">統合する</button>)
    const clear = screen.getByRole('button', { name: '選択を解除' })
    expect(clear.parentElement).toHaveClass('master-actions--divided')
    expect(screen.getByRole('button', { name: '統合する' }).parentElement).not.toBe(clear.parentElement)
  })
})
