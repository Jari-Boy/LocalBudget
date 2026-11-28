// @vitest-environment jsdom
/**
 * TreeSelect の「グループ行として見せる階層つき項目」(asGroup、計画Issue #314)のコンポーネントテスト。
 * 出どころの「外部明細」のように、子を持つ階層つき項目に asGroup を付けると、科目などのグループ行と同じく
 * 名前の押下で開閉し、右端の「すべて」ボタンでその項目(配下すべて)を選ぶことを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TreeSelect } from './TreeSelect'
import type { TreeSelectCategory } from './treeSelectModel'

afterEach(cleanup)

/** 外部明細(グループ行として見せる) > 銀行A・銀行B、手入力 */
const categories: TreeSelectCategory[] = [
  {
    key: 'flat',
    name: '',
    nodes: [
      { kind: 'item', value: 'ext', name: '外部明細', isActive: true, depth: 0, parentValue: null, asGroup: true },
      { kind: 'item', value: 'inst:A', name: '銀行A', isActive: true, depth: 1, parentValue: 'ext' },
      { kind: 'item', value: 'inst:B', name: '銀行B', isActive: true, depth: 1, parentValue: 'ext' },
      { kind: 'item', value: 'manual', name: '手入力', isActive: true },
    ],
  },
]

const renderSelect = (values: string[] = [], onValuesChange = vi.fn()) => {
  render(<TreeSelect label="出どころ" categories={categories} multiple values={values} onValuesChange={onValuesChange} allowGroupSelect />)
  fireEvent.click(screen.getByRole('button', { name: /^出どころ/ }))
  return onValuesChange
}

describe('TreeSelect の階層つき項目のグループ行表示(asGroup)', () => {
  it('名前を押すと開閉し、項目は選ばない(最初は閉じていて子は出ない)', () => {
    const onValuesChange = renderSelect()
    expect(screen.queryByRole('button', { name: '銀行A' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '外部明細' }))
    expect(screen.getByRole('button', { name: '銀行A' })).toBeInTheDocument()
    expect(onValuesChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '外部明細' }))
    expect(screen.queryByRole('button', { name: '銀行A' })).toBeNull()
  })

  it('「すべて」を押すと、その項目を選ぶ(押し込み状態も反映する)', () => {
    const onValuesChange = renderSelect()
    fireEvent.click(screen.getByRole('button', { name: '外部明細をすべて選ぶ' }))
    expect(onValuesChange).toHaveBeenCalledWith(['ext'])
  })

  it('選択中なら「すべて」が押し込み状態になる', () => {
    renderSelect(['ext'])
    expect(screen.getByRole('button', { name: '外部明細をすべて選ぶ' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asGroup を付けない階層つき項目は、従来どおり名前の押下で選び、「すべて」は出ない', () => {
    const plain: TreeSelectCategory[] = [
      {
        key: 'flat',
        name: '',
        nodes: [
          { kind: 'item', value: 'p', name: '親', isActive: true, depth: 0, parentValue: null },
          { kind: 'item', value: 'c', name: '子', isActive: true, depth: 1, parentValue: 'p' },
        ],
      },
    ]
    const onValuesChange = vi.fn()
    render(<TreeSelect label="階層" categories={plain} multiple values={[]} onValuesChange={onValuesChange} allowGroupSelect />)
    fireEvent.click(screen.getByRole('button', { name: /^階層/ }))
    expect(screen.queryByRole('button', { name: '親をすべて選ぶ' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '親' }))
    expect(onValuesChange).toHaveBeenCalledWith(['p'])
  })
})
