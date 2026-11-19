// @vitest-environment jsdom
/**
 * TreeSelect の階層つき項目の開閉(計画Issue #234)のコンポーネントテスト。
 * 子を持つ項目に「▾ / ▸」の開閉の印が付き、名前を押すと選択・印を押すと開閉になること、
 * 選択中の項目の祖先は最初から開くこと、検索中は印が付かず該当する項目まで展開されることを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

const item = (value: string, name: string, depth: number, parentValue: string | null) => ({
  kind: 'item' as const,
  value,
  name,
  isActive: true,
  depth,
  parentValue,
  pathName: name,
})

/** 食費 > 外食 > ランチ、食費 > 自炊、住居 */
const categories: TreeSelectCategory[] = [
  {
    key: 'groups',
    name: 'グループ',
    nodes: [item('1', '食費', 0, null), item('2', '外食', 1, '1'), item('3', 'ランチ', 2, '2'), item('4', '自炊', 1, '1'), item('5', '住居', 0, null)],
  },
]

const renderSelect = (value = '', onChange = vi.fn()) => {
  render(<TreeSelect label="グループ" categories={categories} value={value} onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: /^グループ/ }))
  return onChange
}

describe('TreeSelect の階層つき項目の開閉', () => {
  it('子を持つ項目だけに開閉の印が付き、最初は閉じていて子は出ない', () => {
    renderSelect()
    expect(screen.getByRole('button', { name: '食費を開く' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '住居を開く' })).toBeNull()
    expect(screen.queryByRole('button', { name: '外食' })).toBeNull()
  })

  it('開閉の印を押すと開閉し、選択は変わらず、ポップアップも閉じない', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByRole('button', { name: '食費を開く' }))
    expect(screen.getByRole('button', { name: '外食' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '食費を閉じる' }))
    expect(screen.queryByRole('button', { name: '外食' })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('名前を押すと、子を持つ項目でも、その項目を選ぶ', () => {
    const onChange = renderSelect()
    fireEvent.click(screen.getByRole('button', { name: '食費' }))
    expect(onChange).toHaveBeenCalledWith('1')
  })

  it('選択中の項目の祖先は、最初から開いている(ほかの子孫は閉じたまま)', () => {
    renderSelect('3')
    expect(screen.getByRole('button', { name: '食費を閉じる' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '外食を閉じる' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ランチ' })).toBeInTheDocument()
  })

  it('検索中は、該当する項目まで展開され、開閉の印は出ない', () => {
    renderSelect()
    fireEvent.change(screen.getByLabelText('グループを検索'), { target: { value: 'ランチ' } })
    expect(screen.getByRole('button', { name: 'ランチ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /を(開く|閉じる)$/ })).toBeNull()
  })
})
