// @vitest-environment jsdom
/**
 * CounterpartySelect(取引先を1つ選ぶ共通の選択欄、計画Issue #234)のコンポーネントテスト。
 * 取引先と取引先グループを受け取り、グループの階層・検索(ひらがな/カタカナを区別しない)・Enter確定・
 * 先頭固定の特別な項目・絞り込み条件(filter)・現在の値(無効でも残す)が、部品の中で行われることを検証する。
 * 外部依存なし(DB・Repositoryに依存せず、取引先とグループの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import { CounterpartySelect } from './CounterpartySelect'

afterEach(cleanup)

const counterparty = (id: number, name: string, counterpartyGroupId: number | null, isActive = true): Counterparty => ({
  id,
  name,
  counterpartyGroupId,
  sortOrder: id,
  isActive,
  createdAt: '',
  updatedAt: '',
})

const group = (id: number, name: string, parentGroupId: number | null = null): CounterpartyGroup => ({
  id,
  name,
  parentGroupId,
  sortOrder: id,
  isActive: true,
  createdAt: '',
  updatedAt: '',
})

const groups = [group(1, '日用品・雑貨'), group(2, 'ドラッグストア', 1)]
const counterparties = [
  counterparty(10, 'サンドラッグ新宿店', 2),
  counterparty(11, 'ダイソー', 1),
  counterparty(12, '未分類の店', null),
  counterparty(13, '閉店した店', null, false),
]

const open = () => fireEvent.click(screen.getByRole('button', { name: /^取引先/ }))
/** 開いて検索語を入れる(グループは既定で折りたたまれているが、検索中は該当する取引先まで展開される) */
const openAndSearch = (query: string) => {
  open()
  fireEvent.change(screen.getByLabelText('取引先を検索'), { target: { value: query } })
}

describe('CounterpartySelect', () => {
  it('検索すると、該当する取引先と、その親のグループが階層どおりに出る', () => {
    render(<CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} value="" onChange={vi.fn()} />)
    openAndSearch('さんどらっぐ')
    expect(screen.getByText('日用品・雑貨')).toBeInTheDocument()
    expect(screen.getByText('ドラッグストア')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'サンドラッグ新宿店' })).toBeInTheDocument()
  })

  it('取引先を選ぶと、取引先のidの文字列で onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} value="" onChange={onChange} />)
    openAndSearch('ダイソー')
    fireEvent.click(screen.getByRole('button', { name: 'ダイソー' }))
    expect(onChange).toHaveBeenCalledWith('11')
  })

  it('ひらがなで検索して1件に絞れたら、Enter で確定できる', () => {
    const onChange = vi.fn()
    render(<CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} value="" onChange={onChange} />)
    openAndSearch('だいそー')
    fireEvent.keyDown(screen.getByLabelText('取引先を検索'), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('11')
  })

  it('filterに合わない取引先は候補に出さない(有効な取引先だけ、など)', () => {
    render(
      <CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} filter={(c) => c.isActive} value="" onChange={vi.fn()} />,
    )
    openAndSearch('閉店')
    expect(screen.queryByRole('button', { name: '閉店した店' })).toBeNull()
  })

  it('filterに合わなくても、現在の値の取引先は残す', () => {
    render(
      <CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} filter={(c) => c.isActive} value="13" onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: '取引先: 閉店した店' })).toBeInTheDocument()
  })

  it('emptyLabelを渡すと、先頭に未選択の項目を出し、選ぶと空文字で onChange が呼ばれる', () => {
    const onChange = vi.fn()
    render(<CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} value="11" onChange={onChange} emptyLabel="未設定" />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '未設定' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('leadingOptionsを渡すと、特別な項目を先頭に固定して選べる', () => {
    const onChange = vi.fn()
    render(
      <CounterpartySelect
        label="取引先"
        counterparties={counterparties}
        counterpartyGroups={groups}
        value="__keep"
        onChange={onChange}
        leadingOptions={[
          { value: '__keep', label: '変更しない' },
          { value: '__clear', label: '未設定にする' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: '取引先: 変更しない' })).toBeInTheDocument()
    open()
    fireEvent.click(screen.getByRole('button', { name: '未設定にする' }))
    expect(onChange).toHaveBeenCalledWith('__clear')
  })

  it('disabledのときは、現在の値は見えたまま押せない', () => {
    render(<CounterpartySelect label="取引先" counterparties={counterparties} counterpartyGroups={groups} value="11" onChange={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: '取引先: ダイソー' })).toBeDisabled()
  })
})
