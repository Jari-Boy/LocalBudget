// @vitest-environment jsdom
/**
 * Linesテーブル共通コンポーネント(JournalEntryLinesTable、計画Issue #125)の
 * コンポーネントテスト。Entry項目(取引日・摘要・起票者)のヘッダー表示(編集可能/
 * 読み取り専用の出し分け)、借方/貸方複数行のテーブル表示、行の追加・削除・各セル編集時の
 * コールバック呼び出し、取引先入力欄がPL科目行にのみ表示されその場で新規作成できること、
 * 借方合計・貸方合計・差額の表示を、モックデータを使った単体のレンダリングテストとして
 * 検証する。外部依存: なし(masterData・コールバックはすべてテスト側のモック)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../infrastructure/i18n/i18n'
import type { Account } from '../../domain/account/Account'
import type { Project } from '../../domain/project/Project'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import { createEmptyJournalEntryFormLine, type JournalEntryFormLine } from './journalEntryFormLine'
import { JournalEntryLinesTable, type JournalEntryLineRow } from './JournalEntryLinesTable'

afterEach(cleanup)

function createAccount(overrides: Partial<Account> & { id: number; name: string }): Account {
  return {
    category: 'expense',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function createRow(key: number, line?: Partial<JournalEntryFormLine>): JournalEntryLineRow {
  return { key, line: { ...createEmptyJournalEntryFormLine(), ...line } }
}

function renderTable(overrides?: {
  lineRows?: JournalEntryLineRow[]
  accounts?: Account[]
  projects?: Project[]
  householdMembers?: HouseholdMember[]
  counterparties?: Counterparty[]
  readOnlyHeader?: boolean
  onUpdateLine?: ReturnType<typeof vi.fn>
  onAddLine?: () => void
  onRemoveLine?: (key: number) => void
}) {
  const onUpdateLine = overrides?.onUpdateLine ?? vi.fn()
  const onAddLine = overrides?.onAddLine ?? vi.fn()
  const onRemoveLine = overrides?.onRemoveLine ?? vi.fn()
  const onEntryDateChange = vi.fn()
  const onMemoChange = vi.fn()
  const onHeaderHouseholdMemberChange = vi.fn()
  const onCreateCounterparty = vi.fn()
  const lineRows = overrides?.lineRows ?? [createRow(1), createRow(2)]

  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryLinesTable
        entryDate="2026-08-11"
        onEntryDateChange={overrides?.readOnlyHeader ? undefined : onEntryDateChange}
        memo="テストメモ"
        onMemoChange={overrides?.readOnlyHeader ? undefined : onMemoChange}
        headerHouseholdMemberId={null}
        onHeaderHouseholdMemberChange={overrides?.readOnlyHeader ? undefined : onHeaderHouseholdMemberChange}
        lineRows={lineRows}
        onUpdateLine={onUpdateLine}
        onAddLine={onAddLine}
        onRemoveLine={onRemoveLine}
        masterData={{
          accounts: overrides?.accounts ?? [],
          projects: overrides?.projects ?? [],
          householdMembers: overrides?.householdMembers ?? [],
          counterparties: overrides?.counterparties ?? [],
        }}
        onCreateCounterparty={onCreateCounterparty}
      />
    </I18nextProvider>,
  )

  return { onUpdateLine, onAddLine, onRemoveLine, onEntryDateChange, onMemoChange, onCreateCounterparty, lineRows }
}

function getLineRowElements() {
  return screen.getAllByRole('row').slice(1)
}

describe('JournalEntryLinesTable', () => {
  it('Entry項目(取引日・摘要・起票者)がヘッダーに表示される', () => {
    renderTable()

    expect(screen.getByLabelText('取引日')).toHaveValue('2026-08-11')
    expect(screen.getByLabelText('摘要(任意)')).toHaveValue('テストメモ')
    expect(screen.getByLabelText('起票者')).toBeInTheDocument()
  })

  it('onEntryDateChange等を省略するとEntry項目ヘッダーが読み取り専用(disabled)になる', () => {
    renderTable({ readOnlyHeader: true })

    expect(screen.getByLabelText('取引日')).toBeDisabled()
    expect(screen.getByLabelText('摘要(任意)')).toBeDisabled()
    expect(screen.getByLabelText('起票者')).toBeDisabled()
  })

  it('lineRowsの件数分だけ行がテーブルに表示される', () => {
    renderTable({ lineRows: [createRow(1), createRow(2), createRow(3)] })

    expect(getLineRowElements()).toHaveLength(3)
  })

  it('科目を選択するとonUpdateLineが対象行のkeyとupdater関数で呼ばれる', () => {
    const expense = createAccount({ id: 10, name: '食費' })
    const { onUpdateLine } = renderTable({ accounts: [expense] })
    const rows = getLineRowElements()

    fireEvent.change(within(rows[0]).getByLabelText('科目'), { target: { value: '10' } })

    expect(onUpdateLine).toHaveBeenCalledWith(1, expect.any(Function))
    const updater = onUpdateLine.mock.calls[0][1] as (line: JournalEntryFormLine) => JournalEntryFormLine
    expect(updater(createEmptyJournalEntryFormLine()).accountId).toBe(10)
  })

  it('金額入力でonUpdateLineが呼ばれる', () => {
    /**
     * onUpdateLineに渡されるupdater関数はevent.target.valueを遅延評価で参照するため、
     * コントロール化された<input>がReactの再描画でDOM上の値を巻き戻した後にupdaterを
     * 呼び出すと古い値を読んでしまう(実際の呼び出し元は常にsetStateの関数更新内で
     * 同期的にupdaterを消費するため問題にならないが、テストでは同期的に消費する必要がある)。
     */
    const captured: { line: JournalEntryFormLine | null } = { line: null }
    const onUpdateLine = vi.fn((_key: number, updater: (line: JournalEntryFormLine) => JournalEntryFormLine) => {
      captured.line = updater(createEmptyJournalEntryFormLine())
    })
    renderTable({ onUpdateLine })
    const rows = getLineRowElements()

    fireEvent.change(within(rows[0]).getByLabelText('金額'), { target: { value: '3000' } })

    expect(captured.line?.amountInput).toBe('3000')
  })

  it('行追加ボタンでonAddLineが呼ばれる', () => {
    const { onAddLine } = renderTable()

    fireEvent.click(screen.getByRole('button', { name: '行を追加する' }))

    expect(onAddLine).toHaveBeenCalledTimes(1)
  })

  it('最小行数(既定2)まで減らすと削除ボタンが無効化される', () => {
    renderTable({ lineRows: [createRow(1), createRow(2)] })
    const rows = getLineRowElements()

    rows.forEach((row) => expect(within(row).getByRole('button', { name: 'この行を削除する' })).toBeDisabled())
  })

  it('最小行数を超えている場合は削除ボタンが有効で、クリックするとonRemoveLineが呼ばれる', () => {
    const { onRemoveLine } = renderTable({ lineRows: [createRow(1), createRow(2), createRow(3)] })
    const rows = getLineRowElements()

    const removeButton = within(rows[2]).getByRole('button', { name: 'この行を削除する' })
    expect(removeButton).toBeEnabled()
    fireEvent.click(removeButton)

    expect(onRemoveLine).toHaveBeenCalledWith(3)
  })

  it('取引先入力欄は選択した科目がPL科目(収益/費用)の行にのみ表示される', () => {
    const expense = createAccount({ id: 1, name: '食費', category: 'expense' })
    const cash = createAccount({ id: 2, name: '現金', category: 'asset' })
    renderTable({
      accounts: [expense, cash],
      lineRows: [createRow(1, { accountId: 1 }), createRow(2, { accountId: 2 })],
    })
    const rows = getLineRowElements()

    expect(within(rows[0]).getByLabelText('取引先(任意)')).toBeInTheDocument()
    expect(within(rows[1]).queryByLabelText('取引先(任意)')).not.toBeInTheDocument()
  })

  it('借方合計・貸方合計・差額が表示される', () => {
    renderTable({
      lineRows: [
        createRow(1, { side: 'debit', amountInput: '3000' }),
        createRow(2, { side: 'credit', amountInput: '2000' }),
      ],
    })

    const totalsSection = screen.getByText('借方合計').closest('.journal-entry-totals') as HTMLElement
    expect(within(totalsSection).getByText('￥3,000')).toBeInTheDocument()
    expect(within(totalsSection).getByText('￥2,000')).toBeInTheDocument()
    expect(within(totalsSection).getByText('￥1,000')).toBeInTheDocument()
  })
})
