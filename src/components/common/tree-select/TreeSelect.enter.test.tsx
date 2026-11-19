// @vitest-environment jsdom
/**
 * TreeSelect の「検索で1件に絞れたら Enter で確定」と階層表示のテスト(計画Issue #233)。
 * 検索で候補が1件のとき Enter で選んで閉じ、フォーム全体は送信されないこと、日本語の変換確定の Enter
 * (isComposing)では確定しないこと、検索で親が絞り落とされたら押せない見出し行で残ること、
 * 閉じた状態では同名の項目があるときだけ「親 > 子」で表示することを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

const g = (value: string, name: string, depth: number, parentValue: string | null, pathName: string) => ({
  kind: 'item' as const,
  value,
  name,
  isActive: true,
  depth,
  parentValue,
  pathName,
})

const categories: TreeSelectCategory[] = [
  {
    key: 'groups',
    name: 'グループ',
    nodes: [
      g('1', '食費', 0, null, '食費'),
      g('2', 'その他', 1, '1', '食費 > その他'),
      g('3', '住居', 0, null, '住居'),
      g('4', 'その他', 1, '3', '住居 > その他'),
      g('5', 'ドラッグストア', 1, '3', '住居 > ドラッグストア'),
    ],
  },
]

function setup(value = '', onSubmit = vi.fn()) {
  const onChange = vi.fn()
  render(
    <form onSubmit={onSubmit}>
      <TreeSelect label="グループ" categories={categories} value={value} onChange={onChange} />
    </form>,
  )
  return { onChange, onSubmit }
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /^グループ/ }))
const search = () => screen.getByRole('searchbox', { name: 'グループを検索' })

describe('TreeSelect の Enter 確定', () => {
  it('検索で1件に絞れたとき Enter で選んで閉じ、フォームは送信されない', () => {
    const { onChange, onSubmit } = setup()
    open()
    fireEvent.change(search(), { target: { value: 'どらっぐ' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('5')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('2件以上のときは Enter で確定しない(フォームも送信しない)', () => {
    const { onChange, onSubmit } = setup()
    open()
    fireEvent.change(search(), { target: { value: 'その他' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('日本語の変換確定の Enter(isComposing)では確定しない', () => {
    const { onChange } = setup()
    open()
    fireEvent.change(search(), { target: { value: 'どらっぐ' } })
    fireEvent.keyDown(search(), { key: 'Enter', isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keyCode 229(変換中)の Enter でも確定しない', () => {
    const { onChange } = setup()
    open()
    fireEvent.change(search(), { target: { value: 'どらっぐ' } })
    fireEvent.keyDown(search(), { key: 'Enter', keyCode: 229 })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('TreeSelect の階層表示', () => {
  it('検索で親が絞り落とされたら、親を押せない見出し行として残す', () => {
    setup()
    open()
    fireEvent.change(search(), { target: { value: 'どらっぐ' } })
    expect(screen.getByText('住居')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '住居' })).toBeNull()
    expect(screen.getByRole('button', { name: 'ドラッグストア' })).toBeInTheDocument()
  })

  it('閉じた状態では、同名の項目があるときだけ「親 > 子」で表示する', () => {
    setup('2')
    expect(screen.getByRole('button', { name: 'グループ: 食費 > その他' })).toBeInTheDocument()
  })

  it('同名が他に無ければ、名前だけで表示する', () => {
    setup('5')
    expect(screen.getByRole('button', { name: 'グループ: ドラッグストア' })).toBeInTheDocument()
  })
})
