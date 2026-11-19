// @vitest-environment jsdom
/**
 * GroupNodeSelect(ツリーのノードから、親グループ・移動先のグループを1つ選ぶ共通の選択欄、計画Issue #234)の
 * コンポーネントテスト。区分の最上位(グループなし)を先頭に固定し、グループを階層・開閉・検索つきで出し、
 * 選んだグループはノードid(「g:1」など)で通知することを検証する。外部依存なし(ノードの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { GroupNodeSelect } from './GroupNodeSelect'

afterEach(cleanup)

const node = (id: string, kind: 'group' | 'leaf', category: string, parentId: string | null, name: string): TreeTableNode => ({
  id,
  kind,
  category,
  parentId,
  name,
  cells: [],
})

const nodes: TreeTableNode[] = [
  node('g:1', 'group', 'expense', null, '食費'),
  node('g:2', 'group', 'expense', 'g:1', '外食'),
  node('g:3', 'group', 'expense', null, '住居'),
  node('g:4', 'group', 'revenue', null, '給与'),
]

const props = { label: '所属グループ', nodes, categoryKey: 'expense', excludedIds: [] as string[], topId: 'cat:expense', topLabel: 'グループなし' }
const open = () => fireEvent.click(screen.getByRole('button', { name: /^所属グループ/ }))

describe('GroupNodeSelect', () => {
  it('現在の値が区分の最上位なら、その文言をボタンに出す', () => {
    render(<GroupNodeSelect {...props} value="cat:expense" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '所属グループ: グループなし' })).toBeInTheDocument()
  })

  it('現在の値がグループなら、そのグループの名前をボタンに出す', () => {
    render(<GroupNodeSelect {...props} value="g:2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '所属グループ: 外食' })).toBeInTheDocument()
  })

  it('先頭に「グループなし」を固定し、選ぶと区分の最上位のidで通知する', () => {
    const onChange = vi.fn()
    render(<GroupNodeSelect {...props} value="g:1" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'グループなし' }))
    expect(onChange).toHaveBeenCalledWith('cat:expense')
  })

  it('グループを選ぶと、ノードidで通知する(「n:」の接頭辞は外す)', () => {
    const onChange = vi.fn()
    render(<GroupNodeSelect {...props} value="cat:expense" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '住居' }))
    expect(onChange).toHaveBeenCalledWith('g:3')
  })

  it('子を持つグループは最初は閉じていて、開閉の印で子を出せる。ほかの区分のグループは出ない', () => {
    render(<GroupNodeSelect {...props} value="cat:expense" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '外食' })).toBeNull()
    expect(screen.queryByRole('button', { name: '給与' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '食費を開く' }))
    expect(screen.getByRole('button', { name: '外食' })).toBeInTheDocument()
  })

  it('excludedIdsに指定したグループ(自分自身と配下)は、候補に出ない', () => {
    render(<GroupNodeSelect {...props} excludedIds={['g:3']} value="cat:expense" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '住居' })).toBeNull()
  })

  it('値が空のときは、placeholderを出す(一括移動の「選択してください」)', () => {
    render(<GroupNodeSelect {...props} value="" placeholder="選択してください" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '所属グループ: 選択してください' })).toBeInTheDocument()
  })

  it('検索して1件に絞れたら、Enterで確定できる', () => {
    const onChange = vi.fn()
    render(<GroupNodeSelect {...props} value="cat:expense" onChange={onChange} />)
    open()
    const search = screen.getByLabelText('所属グループを検索')
    fireEvent.change(search, { target: { value: '住居' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('g:3')
  })
})
