// @vitest-environment jsdom
/**
 * TreeSelect の先頭固定の特別な項目(leadingOptions、計画Issue #234)のコンポーネントテスト。
 * 「変更しない」「未設定にする」のように、実体ではない選択肢を、一覧の先頭に固定して出せることを検証する。
 * 外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

const categories: TreeSelectCategory[] = [
  { key: 'expense', name: '費用', nodes: [{ kind: 'item', value: '1', name: '食費', isActive: true }] },
]
const leading = [
  { value: '__keep', label: '変更しない' },
  { value: '__clear', label: '未設定にする' },
]

describe('TreeSelect の先頭固定の特別な項目', () => {
  it('現在の値が特別な項目なら、ボタンにその文言を出す', () => {
    render(<TreeSelect label="科目" categories={categories} value="__keep" onChange={vi.fn()} leadingOptions={leading} />)
    expect(screen.getByRole('button', { name: '科目: 変更しない' })).toBeInTheDocument()
  })

  it('開くと、特別な項目が実体の項目より前に並ぶ', () => {
    render(<TreeSelect label="科目" categories={categories} value="" onChange={vi.fn()} leadingOptions={leading} />)
    fireEvent.click(screen.getByRole('button', { name: /^科目/ }))
    const names = screen.getAllByRole('button').map((b) => b.textContent)
    expect(names.indexOf('変更しない')).toBeLessThan(names.indexOf('食費'))
    expect(names.indexOf('未設定にする')).toBeLessThan(names.indexOf('食費'))
  })

  it('特別な項目を選ぶと、その値で onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<TreeSelect label="科目" categories={categories} value="" onChange={onChange} leadingOptions={leading} />)
    fireEvent.click(screen.getByRole('button', { name: /^科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '未設定にする' }))
    expect(onChange).toHaveBeenCalledWith('__clear')
  })

  it('検索中も、特別な項目は消えない', () => {
    render(<TreeSelect label="科目" categories={categories} value="" onChange={vi.fn()} leadingOptions={leading} />)
    fireEvent.click(screen.getByRole('button', { name: /^科目/ }))
    fireEvent.change(screen.getByLabelText('科目を検索'), { target: { value: '食' } })
    expect(screen.getByRole('button', { name: '変更しない' })).toBeInTheDocument()
  })

  it('検索を1件に絞って Enter を押すと、特別な項目ではなく絞られた実体の項目を選ぶ', () => {
    const onChange = vi.fn()
    render(<TreeSelect label="科目" categories={categories} value="" onChange={onChange} leadingOptions={leading} />)
    fireEvent.click(screen.getByRole('button', { name: /^科目/ }))
    const search = screen.getByLabelText('科目を検索')
    fireEvent.change(search, { target: { value: '食' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('1')
  })
})
