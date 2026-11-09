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
  it('日付・摘要・コメントと、各行の借方/貸方・科目・金額・世帯メンバー・取引先・精算バッチを表示する', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: '仕訳の詳細' })
    expect(dialog).toHaveTextContent('2026-10-30')
    expect(dialog).toHaveTextContent('会社の同僚と')
    const rows = within(dialog).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('借方')
    expect(rows[1]).toHaveTextContent('食費')
    expect(rows[1]).toHaveTextContent('妻')
    expect(rows[1]).toHaveTextContent(formatCurrency(600, 'JPY'))
    expect(rows[2]).toHaveTextContent('友人A')
    expect(rows[2]).toHaveTextContent('ランチの割勘')
  })

  it('「閉じる」を押すと onClose を呼ぶ', () => {
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
