// @vitest-environment jsdom
/**
 * Linesテーブル共通コンポーネント(JournalEntryLinesTable、計画Issue #125)の
 * コンポーネントテスト。Entry項目(取引日・摘要・起票者)のヘッダー表示(編集可能/
 * 読み取り専用の出し分け)、借方/貸方を独立したブロック(紙の仕訳帳のように左右に並べる)
 * として複数行扱えること、各ブロックの行の追加・削除・各セル編集時のコールバック呼び出し、
 * 取引先入力欄がPL科目行にのみ表示されその場で新規作成できること、非アクティブ化済みの
 * プロジェクト・世帯メンバーが新規選択肢から除外されつつ既存選択値は保持されること、
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

function createHouseholdMember(overrides: Partial<HouseholdMember> & { id: number; name: string }): HouseholdMember {
  return {
    isGroup: false,
    isActive: true,
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
  headerHouseholdMemberId?: number | null
  readOnlyHeader?: boolean
  onUpdateLine?: ReturnType<typeof vi.fn>
  onAddLine?: (side: 'debit' | 'credit') => void
  onRemoveLine?: (key: number) => void
}) {
  const onUpdateLine = overrides?.onUpdateLine ?? vi.fn()
  const onAddLine = overrides?.onAddLine ?? vi.fn()
  const onRemoveLine = overrides?.onRemoveLine ?? vi.fn()
  const onEntryDateChange = vi.fn()
  const onMemoChange = vi.fn()
  const onHeaderHouseholdMemberChange = vi.fn()
  const onCreateCounterparty = vi.fn()
  const lineRows = overrides?.lineRows ?? [
    createRow(1, { side: 'debit' }),
    createRow(2, { side: 'credit' }),
  ]

  render(
    <I18nextProvider i18n={i18n}>
      <JournalEntryLinesTable
        entryDate="2026-08-11"
        onEntryDateChange={overrides?.readOnlyHeader ? undefined : onEntryDateChange}
        memo="テストメモ"
        onMemoChange={overrides?.readOnlyHeader ? undefined : onMemoChange}
        headerHouseholdMemberId={overrides?.headerHouseholdMemberId ?? null}
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

/** 借方ブロック・貸方ブロックそれぞれのtable要素を取得する(DOM上、借方が先に描画される) */
function getBlockTables(): { debitTable: HTMLElement; creditTable: HTMLElement } {
  const tables = screen.getAllByRole('table')
  return { debitTable: tables[0], creditTable: tables[1] }
}

function getRowsIn(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole('row').slice(1)
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

  it('借方/貸方が独立したブロックとして表示され、side別に行が振り分けられる', () => {
    renderTable({
      lineRows: [
        createRow(1, { side: 'debit' }),
        createRow(2, { side: 'debit' }),
        createRow(3, { side: 'credit' }),
      ],
    })

    expect(screen.getByRole('heading', { name: '借方' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '貸方' })).toBeInTheDocument()
    const { debitTable, creditTable } = getBlockTables()
    expect(getRowsIn(debitTable)).toHaveLength(2)
    expect(getRowsIn(creditTable)).toHaveLength(1)
  })

  it('科目を選択するとonUpdateLineが対象行のkeyとupdater関数で呼ばれる', () => {
    const expense = createAccount({ id: 10, name: '食費' })
    const { onUpdateLine } = renderTable({ accounts: [expense] })
    const { debitTable } = getBlockTables()
    const rows = getRowsIn(debitTable)

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
    const { debitTable } = getBlockTables()
    const rows = getRowsIn(debitTable)

    fireEvent.change(within(rows[0]).getByLabelText('金額'), { target: { value: '3000' } })

    expect(captured.line?.amountInput).toBe('3000')
  })

  it('借方ブロックの「借方行を追加する」ボタンでonAddLineが"debit"付きで呼ばれる', () => {
    const { onAddLine } = renderTable()

    fireEvent.click(screen.getByRole('button', { name: '借方行を追加する' }))

    expect(onAddLine).toHaveBeenCalledWith('debit')
  })

  it('貸方ブロックの「貸方行を追加する」ボタンでonAddLineが"credit"付きで呼ばれる', () => {
    const { onAddLine } = renderTable()

    fireEvent.click(screen.getByRole('button', { name: '貸方行を追加する' }))

    expect(onAddLine).toHaveBeenCalledWith('credit')
  })

  it('借方・貸方の合計行数が最小行数(既定2)の場合、どちらのブロックの削除ボタンも無効化される', () => {
    renderTable({ lineRows: [createRow(1, { side: 'debit' }), createRow(2, { side: 'credit' })] })

    const { debitTable, creditTable } = getBlockTables()
    expect(within(getRowsIn(debitTable)[0]).getByRole('button', { name: 'この行を削除する' })).toBeDisabled()
    expect(within(getRowsIn(creditTable)[0]).getByRole('button', { name: 'この行を削除する' })).toBeDisabled()
  })

  it('合計行数が最小行数を超えている場合は削除ボタンが有効で、クリックするとonRemoveLineが呼ばれる', () => {
    const { onRemoveLine } = renderTable({
      lineRows: [createRow(1, { side: 'debit' }), createRow(2, { side: 'debit' }), createRow(3, { side: 'credit' })],
    })
    const { debitTable } = getBlockTables()
    const rows = getRowsIn(debitTable)

    const removeButton = within(rows[1]).getByRole('button', { name: 'この行を削除する' })
    expect(removeButton).toBeEnabled()
    fireEvent.click(removeButton)

    expect(onRemoveLine).toHaveBeenCalledWith(2)
  })

  it('ヘッダーの起票者選択は非アクティブ化済みの世帯メンバーを新規選択肢に含まない(docs/domain/household-members.md 1.3)', () => {
    const active = createHouseholdMember({ id: 1, name: '夫' })
    const inactive = createHouseholdMember({ id: 2, name: '元同居人', isActive: false })
    renderTable({ householdMembers: [active, inactive] })

    const select = screen.getByLabelText('起票者') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent)
    expect(optionTexts).toContain('夫')
    expect(optionTexts).not.toContain('元同居人')
  })

  it('ヘッダーの起票者が非アクティブ化済みメンバーを指している場合、選択済みの値は表示から消えない', () => {
    const inactive = createHouseholdMember({ id: 2, name: '元同居人', isActive: false })
    renderTable({ householdMembers: [inactive], headerHouseholdMemberId: 2 })

    const select = screen.getByLabelText('起票者') as HTMLSelectElement
    expect(select).toHaveValue('2')
    expect(within(select).getByText('元同居人')).toBeInTheDocument()
  })

  it('明細行の世帯メンバー選択は非アクティブ化済みのメンバーを新規選択肢に含まない(docs/domain/household-members.md 1.3)', () => {
    const active = createHouseholdMember({ id: 1, name: '夫' })
    const inactive = createHouseholdMember({ id: 2, name: '元同居人', isActive: false })
    renderTable({ householdMembers: [active, inactive] })
    const { debitTable } = getBlockTables()
    const rows = getRowsIn(debitTable)

    const select = within(rows[0]).getByLabelText('世帯メンバー(任意)') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent)
    expect(optionTexts).toContain('夫')
    expect(optionTexts).not.toContain('元同居人')
  })

  it('明細行の世帯メンバー選択が非アクティブ化済みメンバーを指している場合、選択済みの値は表示から消えない', () => {
    const inactive = createHouseholdMember({ id: 2, name: '元同居人', isActive: false })
    renderTable({
      householdMembers: [inactive],
      lineRows: [
        createRow(1, { side: 'debit', householdMemberId: 2 }),
        createRow(2, { side: 'credit' }),
      ],
    })
    const { debitTable } = getBlockTables()
    const rows = getRowsIn(debitTable)

    const select = within(rows[0]).getByLabelText('世帯メンバー(任意)') as HTMLSelectElement
    expect(select).toHaveValue('2')
    expect(within(select).getByText('元同居人')).toBeInTheDocument()
  })

  it('非アクティブ化済みのプロジェクトは新規選択肢に含まれないが、既存の選択値は表示から消えない', () => {
    const activeProject: Project = {
      id: 1,
      name: '26年7月アメリカ旅行',
      kind: 'event',
      isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    const inactiveProject: Project = {
      id: 2,
      name: '25年冬の旅行',
      kind: 'event',
      isActive: false,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }
    renderTable({
      projects: [activeProject, inactiveProject],
      lineRows: [
        createRow(1, { side: 'debit', projectId: 2 }),
        createRow(2, { side: 'credit' }),
      ],
    })
    const { debitTable } = getBlockTables()
    const select = within(getRowsIn(debitTable)[0]).getByLabelText('プロジェクト(任意)') as HTMLSelectElement
    const optionTexts = Array.from(select.options).map((option) => option.textContent)

    expect(optionTexts).toContain('26年7月アメリカ旅行')
    expect(select).toHaveValue('2')
    expect(within(select).getByText('25年冬の旅行')).toBeInTheDocument()
  })

  it('取引先入力欄は選択した科目がPL科目(収益/費用)の行にのみ表示される', () => {
    const expense = createAccount({ id: 1, name: '食費', category: 'expense' })
    const cash = createAccount({ id: 2, name: '現金', category: 'asset' })
    renderTable({
      accounts: [expense, cash],
      lineRows: [
        createRow(1, { side: 'debit', accountId: 1 }),
        createRow(2, { side: 'credit', accountId: 2 }),
      ],
    })
    const { debitTable, creditTable } = getBlockTables()

    expect(within(getRowsIn(debitTable)[0]).getByLabelText('取引先(任意)')).toBeInTheDocument()
    expect(within(getRowsIn(creditTable)[0]).queryByLabelText('取引先(任意)')).not.toBeInTheDocument()
  })

  it('取引先入力欄から新規取引先をその場で作成して選択できる', async () => {
    const expense = createAccount({ id: 1, name: '食費', category: 'expense' })
    const { onCreateCounterparty } = renderTable({
      accounts: [expense],
      lineRows: [
        createRow(1, { side: 'debit', accountId: 1 }),
        createRow(2, { side: 'credit' }),
      ],
    })
    const { debitTable } = getBlockTables()
    const row = getRowsIn(debitTable)[0]

    fireEvent.change(within(row).getByLabelText('取引先(任意)'), { target: { value: '__new__' } })
    fireEvent.change(within(row).getByLabelText('新しい取引先名'), { target: { value: '新しい取引先' } })
    fireEvent.click(within(row).getByRole('button', { name: '追加' }))

    expect(onCreateCounterparty).toHaveBeenCalledWith('新しい取引先')
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
