// @vitest-environment jsdom
/**
 * TreeSelect の先頭に固定する候補(pinnedValues、計画Issue #236)のコンポーネントテスト。
 * 明細取込で、摘要に複数のキーワードが一致した行の取引先欄を開いたとき、一致した取引先を渡された順に先頭に並べ、
 * その下に標準のマスタ表示(区分・グループの階層)を続けられることを検証する。
 * 渡さなければ何も増えないこと、候補は検索の語に合うものだけに絞られることも確かめる。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

const categories: TreeSelectCategory[] = [
  {
    key: 'all',
    name: '取引先',
    nodes: [
      {
        kind: 'group',
        id: 'g1',
        name: '交通',
        children: [
          { kind: 'item', value: '1', name: 'ジェイアール東日本', isActive: true },
          { kind: 'item', value: '2', name: '東京メトロ', isActive: true },
        ],
      },
      { kind: 'item', value: '3', name: 'ミニストップ', isActive: true },
    ],
  },
]

function renderSelect(pinnedValues?: readonly string[], onChange = vi.fn()) {
  render(
    <TreeSelect
      label="取引先"
      categories={categories}
      value=""
      onChange={onChange}
      emptyLabel="取引先なし"
      pinnedValues={pinnedValues}
      pinnedLabel="この摘要に一致した候補"
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^取引先/ }))
  return { onChange }
}

const labels = () => screen.getAllByRole('button').map((b) => b.textContent)

describe('TreeSelect の先頭に固定する候補', () => {
  it('候補を渡すと、見出しと、渡した順の候補が、標準のマスタ表示より前に並ぶ', () => {
    renderSelect(['3', '1'])

    expect(screen.getByText('この摘要に一致した候補')).toBeInTheDocument()
    const names = labels()
    const first = names.indexOf('ミニストップ')
    expect(names.indexOf('ジェイアール東日本')).toBeGreaterThan(first)
    // 標準のマスタ表示(グループ見出しと、グループ配下の項目)は、候補の後ろに続く
    expect(names.lastIndexOf('ミニストップ')).toBeGreaterThan(names.indexOf('ジェイアール東日本'))
    expect(screen.getByText('交通')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取引先なし' })).toBeInTheDocument()
  })

  it('候補を選ぶと、その値でonChangeが呼ばれる', () => {
    const { onChange } = renderSelect(['3', '1'])

    fireEvent.click(screen.getAllByRole('button', { name: 'ジェイアール東日本' })[0])

    expect(onChange).toHaveBeenCalledWith('1')
  })

  it('候補を渡さない(または空)なら、見出しは出ない', () => {
    renderSelect(undefined)
    expect(screen.queryByText('この摘要に一致した候補')).not.toBeInTheDocument()
    cleanup()
    renderSelect([])
    expect(screen.queryByText('この摘要に一致した候補')).not.toBeInTheDocument()
  })

  it('検索中は、検索の語に合う候補だけが残り、合う候補が無ければ見出しも消える', () => {
    renderSelect(['3', '1'])

    fireEvent.change(screen.getByLabelText('取引先を検索'), { target: { value: 'じぇいあーる' } })
    expect(screen.getByText('この摘要に一致した候補')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'ミニストップ' })).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('取引先を検索'), { target: { value: '東京' } })
    expect(screen.queryByText('この摘要に一致した候補')).not.toBeInTheDocument()
  })
})
