// @vitest-environment jsdom
/**
 * BatchSelect の「その場で精算バッチを追加」(計画Issue #269)のコンポーネントテスト。
 * onCreateBatch を渡すと、検索欄の直下に「+ 新しいバッチ」が出て、押すと名前だけの「精算バッチを追加」ダイアログが開き、
 * 追加すると作ったバッチがそのまま選ばれること、キャンセル・失敗では選択が変わらないこと、
 * 同名のバッチ(クローズ済みを含む)があるときは警告を出すが追加は止めないことを検証する。
 * 外部依存なし(作成はコールバックをvi.fnで置き換える)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { BatchSelect } from './BatchSelect'

afterEach(cleanup)

const batch = (id: number, name: string, isActive = true): SettlementBatch => ({
  id,
  name,
  type: 'expense_splitting',
  counterpartyId: null,
  isActive,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
})

const batches = [batch(1, '6月の割勘'), batch(2, '家賃の割勘', false)]

function renderSelect(onCreateBatch?: (name: string) => Promise<SettlementBatch>, onChange = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <BatchSelect label="精算バッチ" batches={batches} value="1" emptyLabel="精算バッチなし" onChange={onChange} onCreateBatch={onCreateBatch} />
    </I18nextProvider>,
  )
  return { onChange }
}

const openSelect = () => fireEvent.click(screen.getByRole('button', { name: /^精算バッチ/ }))
const openDialog = () => {
  openSelect()
  fireEvent.click(screen.getByRole('button', { name: '+ 新しいバッチ' }))
}

describe('BatchSelect のその場追加', () => {
  it('onCreateBatch を渡すと、選択欄に「+ 新しいバッチ」が出る', () => {
    renderSelect(vi.fn())
    openSelect()
    expect(screen.getByRole('button', { name: '+ 新しいバッチ' })).toBeInTheDocument()
  })

  it('onCreateBatch を渡さないときは、「+ 新しいバッチ」は出ない', () => {
    renderSelect(undefined)
    openSelect()
    expect(screen.queryByRole('button', { name: '+ 新しいバッチ' })).toBeNull()
  })

  it('「+ 新しいバッチ」を押すと、名前だけを入れる「精算バッチを追加」ダイアログが開く', () => {
    renderSelect(vi.fn())
    openDialog()
    expect(screen.getByRole('dialog', { name: '精算バッチを追加' })).toBeInTheDocument()
    expect(screen.getByLabelText('バッチ名')).toBeInTheDocument()
    expect(screen.queryByText('相手')).toBeNull()
  })

  it('名前を入れて追加すると、作ったバッチのidで選択が変わる', async () => {
    const onCreateBatch = vi.fn(async (name: string) => batch(9, name))
    const { onChange } = renderSelect(onCreateBatch)
    openDialog()
    fireEvent.change(screen.getByLabelText('バッチ名'), { target: { value: '12月の忘年会' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('9'))
    expect(onCreateBatch).toHaveBeenCalledWith('12月の忘年会')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('キャンセルすると、何も作らず選択も変わらない', () => {
    const onCreateBatch = vi.fn(async (name: string) => batch(9, name))
    const { onChange } = renderSelect(onCreateBatch)
    openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCreateBatch).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('作成に失敗したときは、選択は変わらずダイアログに残る', async () => {
    const onCreateBatch = vi.fn(async () => {
      throw new Error('fail')
    })
    const { onChange } = renderSelect(onCreateBatch)
    openDialog()
    fireEvent.change(screen.getByLabelText('バッチ名'), { target: { value: '新規' } })
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '精算バッチを追加' })).toBeInTheDocument()
  })

  it('同じ名前のバッチ(クローズ済みを含む)があるときは警告を出すが、追加はできる', async () => {
    const onCreateBatch = vi.fn(async (name: string) => batch(9, name))
    const { onChange } = renderSelect(onCreateBatch)
    openDialog()
    fireEvent.change(screen.getByLabelText('バッチ名'), { target: { value: '家賃の割勘' } })
    expect(screen.getByRole('status')).toHaveTextContent('同じ名前のバッチがあります')
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('9'))
  })

  it('同じ名前のバッチがなければ、警告は出ない', () => {
    renderSelect(vi.fn())
    openDialog()
    fireEvent.change(screen.getByLabelText('バッチ名'), { target: { value: '新しい名前' } })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
