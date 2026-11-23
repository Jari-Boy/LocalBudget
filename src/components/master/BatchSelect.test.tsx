// @vitest-environment jsdom
/**
 * BatchSelect(精算バッチを1つ選ぶ共通の選択欄、計画Issue #234)のコンポーネントテスト。
 * 階層のないバッチをフラットに並べ、先頭の特別な項目(なし・変更しない・新しいバッチを作成など)を固定し、
 * 「+ 新しいバッチ」の操作を出せ、検索1件でEnter確定できることを検証する。外部依存なし(バッチの配列だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { BatchSelect } from './BatchSelect'

afterEach(cleanup)

const batch = (id: number, name: string): SettlementBatch => ({
  id,
  name,
  type: 'expense_splitting',
  counterpartyId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const batches = [batch(1, '6月の割勘'), batch(2, '沖縄旅行の割勘'), batch(3, '10月の立替')]
const open = () => fireEvent.click(screen.getByRole('button', { name: /^精算バッチ/ }))

describe('BatchSelect', () => {
  it('現在の値のバッチの名前をボタンに出す', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '精算バッチ: 沖縄旅行の割勘' })).toBeInTheDocument()
  })

  it('値が空のときは、emptyLabelをボタンに出す', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="" emptyLabel="精算バッチなし" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '精算バッチ: 精算バッチなし' })).toBeInTheDocument()
  })

  it('バッチを選ぶと、そのid(文字列)で通知する', () => {
    const onChange = vi.fn()
    render(<BatchSelect label="精算バッチ" batches={batches} value="" emptyLabel="精算バッチなし" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '10月の立替' }))
    expect(onChange).toHaveBeenCalledWith('3')
  })

  it('emptyLabelの項目を選ぶと、空文字で通知する', () => {
    const onChange = vi.fn()
    render(<BatchSelect label="精算バッチ" batches={batches} value="1" emptyLabel="精算バッチなし" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '精算バッチなし' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('バッチは元の並び順のまま出る(並び替えない)', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="" onChange={vi.fn()} />)
    open()
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '').filter((n) => batches.some((x) => x.name === n))
    expect(names).toEqual(['6月の割勘', '沖縄旅行の割勘', '10月の立替'])
  })

  it('filterに合わないバッチは候補に出ない(現在の値は残す)', () => {
    const exceptOkinawa = (b: SettlementBatch) => b.id !== 2
    render(<BatchSelect label="精算バッチ" batches={batches} filter={exceptOkinawa} value="1" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '沖縄旅行の割勘' })).toBeNull()
    expect(screen.getByRole('button', { name: '10月の立替' })).toBeInTheDocument()
  })

  it('filterに合わなくても、現在の値のバッチは候補に残る', () => {
    const exceptOkinawa = (b: SettlementBatch) => b.id !== 2
    render(<BatchSelect label="精算バッチ" batches={batches} filter={exceptOkinawa} value="2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '精算バッチ: 沖縄旅行の割勘' })).toBeInTheDocument()
    open()
    expect(screen.getAllByText('沖縄旅行の割勘').length).toBeGreaterThan(1)
  })

  it('leadingOptionsの特別な項目を先頭に出し、選ぶとその値で通知する', () => {
    const onChange = vi.fn()
    const leading = [{ value: 'new', label: '新しいバッチを作成' }]
    render(<BatchSelect label="精算バッチ" batches={batches} leadingOptions={leading} value="1" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '新しいバッチを作成' }))
    expect(onChange).toHaveBeenCalledWith('new')
  })

  it('leadingOptionsの値が現在の値のときは、その文言をボタンに出す', () => {
    const leading = [{ value: 'new', label: '新しいバッチを作成' }]
    render(<BatchSelect label="精算バッチ" batches={batches} leadingOptions={leading} value="new" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '精算バッチ: 新しいバッチを作成' })).toBeInTheDocument()
  })

  it('onCreateを渡すと、「+ 新しいバッチ」の操作を出し、押すとonCreateを呼ぶ(値は変えない)', () => {
    const onCreate = vi.fn()
    const onChange = vi.fn()
    render(<BatchSelect label="精算バッチ" batches={batches} value="" emptyLabel="精算バッチなし" onCreate={onCreate} createLabel="新しいバッチ" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: '+ 新しいバッチ' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('onCreateを渡さないときは、「+ 新しいバッチ」の操作は出ない', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="" createLabel="新しいバッチ" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: '+ 新しいバッチ' })).toBeNull()
  })

  it('階層がないので、開閉の印は出ない', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="" onChange={vi.fn()} />)
    open()
    expect(screen.queryByRole('button', { name: /を開く|を閉じる/ })).toBeNull()
  })

  it('検索して1件に絞れたら、Enterで確定できる', () => {
    const onChange = vi.fn()
    render(<BatchSelect label="精算バッチ" batches={batches} value="" emptyLabel="精算バッチなし" onChange={onChange} />)
    open()
    const search = screen.getByLabelText('精算バッチを検索')
    fireEvent.change(search, { target: { value: '沖縄' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('2')
  })

  it('disabledのときは、押せない', () => {
    render(<BatchSelect label="精算バッチ" batches={batches} value="1" disabled onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^精算バッチ/ })).toBeDisabled()
  })
})
