// @vitest-environment jsdom
/**
 * 関連仕訳ダイアログ(計画Issue #138、UIレビューで仕訳詳細画面への常時インライン表示から
 * 「関連仕訳」ボタン押下で開くダイアログ方式に変更)のコンポーネントテスト。一覧の行自体が
 * クリック対象であること(「詳細を見る」等の明示的なボタンを持たないこと)、関連付け候補が
 * ある場合のみ追加行が表示され、候補を選ぶと確定・キャンセル操作なしに即座にonAddEntryが
 * 呼ばれること、×ボタン・EscapeキーでonCloseが呼ばれることを検証する。外部依存なし
 * (JournalEntryはテスト内で直接組み立てたプレーンオブジェクトを渡す)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { RelatedEntriesDialog, type RelatedEntriesDialogProps } from './RelatedEntriesDialog'

afterEach(cleanup)

function buildEntry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  const id = overrides.id
  return {
    entryDate: '2026-08-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lines: [
      {
        id: id * 10 + 1,
        journalEntryId: id,
        accountId: 1,
        side: 'debit',
        amount: 1000,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        settlementBatchId: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: id * 10 + 2,
        journalEntryId: id,
        accountId: 2,
        side: 'credit',
        amount: 1000,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        settlementBatchId: null,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

function renderDialog(props?: Partial<RelatedEntriesDialogProps>) {
  const onSelectEntry = vi.fn()
  const onAddEntry = vi.fn()
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <RelatedEntriesDialog
        relatedEntries={[]}
        relateCandidates={[]}
        onSelectEntry={onSelectEntry}
        onAddEntry={onAddEntry}
        onClose={onClose}
        isAdding={false}
        addError={null}
        {...props}
      />
    </I18nextProvider>,
  )
  return { onSelectEntry, onAddEntry, onClose }
}

describe('RelatedEntriesDialog', () => {
  it('関連する仕訳が無い場合、空メッセージが表示される', () => {
    renderDialog()
    expect(screen.getByText('関連付けられた仕訳はありません')).toBeInTheDocument()
  })

  it('関連する仕訳の一覧が行として表示され、「詳細を見る」等の明示的なボタンは存在しない', () => {
    const related = buildEntry({ id: 1, entryDate: '2026-08-02', memo: '割勘' })
    renderDialog({ relatedEntries: [related] })

    expect(screen.queryByRole('button', { name: /詳細を見る/ })).not.toBeInTheDocument()
    expect(screen.getByText('2026-08-02')).toBeInTheDocument()
    expect(screen.getByText('割勘')).toBeInTheDocument()
  })

  it('一覧の行をクリックすると、その行のonSelectEntryが呼ばれる', () => {
    const related = buildEntry({ id: 1, entryDate: '2026-08-02', memo: '割勘' })
    const { onSelectEntry } = renderDialog({ relatedEntries: [related] })

    fireEvent.click(screen.getByText('割勘').closest('button')!)

    expect(onSelectEntry).toHaveBeenCalledWith(related)
  })

  it('関連付け候補が無い場合、追加行は表示されない', () => {
    renderDialog({ relateCandidates: [] })
    expect(screen.queryByText('+ 関連仕訳を追加')).not.toBeInTheDocument()
  })

  it('関連付け候補がある場合、追加行を押すとセレクトが現れ、選ぶと確定ボタンなしに即座にonAddEntryが呼ばれる', () => {
    const candidate = buildEntry({ id: 2, entryDate: '2026-09-01', memo: '候補の仕訳' })
    const { onAddEntry } = renderDialog({ relateCandidates: [candidate] })

    fireEvent.click(screen.getByText('+ 関連仕訳を追加'))
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: String(candidate.id) } })

    expect(onAddEntry).toHaveBeenCalledWith(candidate.id)
    expect(screen.queryByRole('button', { name: '関連付ける' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
  })

  it('addErrorが渡されると、エラーメッセージが表示される', () => {
    renderDialog({ addError: '関連付けに失敗しました。もう一度お試しください。' })
    expect(screen.getByRole('alert')).toHaveTextContent('関連付けに失敗しました。もう一度お試しください。')
  })

  it('×ボタンを押すとonCloseが呼ばれる', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escapeキーを押すとonCloseが呼ばれる', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
