// @vitest-environment jsdom
/**
 * 仕訳の詳細ダイアログ(EntryDetailDialog、計画Issue #153)のコンポーネントテスト。
 * 割勘履歴・精算バッチの仕訳から、仕訳画面へ移動せずに仕訳の中身(日付・摘要・各行の科目と金額、
 * 世帯メンバー・取引先・精算バッチ)を読み取り専用で確認できること、閉じる操作を、
 * 外部依存なしの固定データで検証する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { EntryDetailDialog } from './EntryDetailDialog'

afterEach(cleanup)

const accounts = [
  { id: 1, name: '食費', category: 'expense' },
  { id: 3, name: '立替金', category: 'asset' },
] as never

const entry = {
  id: 3,
  entryDate: '2026-10-30',
  memo: 'ランチの割勘',
  comment: '会社の同僚と',
  currency: 'JPY',
  sourceType: 'expense_splitting',
  householdMemberId: 1,
  lines: [
    { id: 31, accountId: 1, side: 'debit', amount: 600, householdMemberId: 2, counterpartyId: null, settlementBatchId: null },
    { id: 32, accountId: 3, side: 'debit', amount: 600, householdMemberId: null, counterpartyId: 9, settlementBatchId: 7 },
  ],
} as unknown as JournalEntry

function renderDialog(onClose = vi.fn()) {
  render(
    <EntryDetailDialog
      entry={entry}
      accounts={accounts}
      members={[{ id: 2, name: '妻' }]}
      counterparties={[{ id: 9, name: '友人A' }]}
      batches={[{ id: 7, name: 'ランチの割勘' }]}
      onClose={onClose}
    />,
  )
  return { onClose }
}

describe('EntryDetailDialog', () => {
  it('日付・摘要・コメントを表示し、借方と貸方を別々の欄に分けて科目・金額・世帯メンバー・取引先・精算バッチを出す', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: '仕訳の詳細' })
    expect(dialog).toHaveTextContent('2026-10-30')
    expect(dialog).toHaveTextContent('会社の同僚と')
    const debit = within(dialog).getByRole('region', { name: '借方' })
    const debitRows = within(debit).getAllByRole('row')
    expect(debitRows).toHaveLength(3)
    expect(debitRows[1]).toHaveTextContent('食費')
    expect(debitRows[1]).toHaveTextContent('妻')
    expect(debitRows[1]).toHaveTextContent(formatCurrency(600, 'JPY'))
    expect(debitRows[2]).toHaveTextContent('友人A')
    expect(debitRows[2]).toHaveTextContent('ランチの割勘')
    const credit = within(dialog).getByRole('region', { name: '貸方' })
    expect(within(credit).getAllByRole('row')).toHaveLength(2)
    expect(within(credit).getByText('貸方の行はありません')).toBeInTheDocument()
  })

  it('貸方の行は貸方の欄に出る', () => {
    render(
      <EntryDetailDialog
        entry={
          {
            ...entry,
            lines: [{ id: 33, accountId: 1, side: 'credit', amount: 900, householdMemberId: null, counterpartyId: null, settlementBatchId: null }],
          } as unknown as JournalEntry
        }
        accounts={accounts}
        members={[]}
        counterparties={[]}
        batches={[]}
        onClose={vi.fn()}
      />,
    )

    const credit = screen.getByRole('region', { name: '貸方' })
    expect(within(credit).getByText('食費')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '借方' })).queryByText('食費')).not.toBeInTheDocument()
  })

  it('「閉じる」を押すと onClose を呼ぶ', () => {
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
