// @vitest-environment jsdom
/**
 * 明細行単位の表(JournalLineTable)の一括編集のための行選択(計画Issue #182)のコンポーネントテスト。
 * bulk を渡さなければチェックボックスはないこと、借方・貸方の各側の先頭に明細1行ごとのチェックボックスが出る
 * (足りない側の空欄にはない)こと、選択状態の表示、チェックを押しても仕訳の選択(行を押す操作)にならないこと、
 * 見出しのチェックでその側の全行を選べること(全選択・一部・なしの状態)、押せない状態(disabled)、
 * 編集中の仕訳にはチェックが出ないこと、選択の列が列幅の調整の対象外で表の最小幅に含まれることを検証する。
 * 外部依存なし(表示用の名前解決関数 lookup と JournalEntry を渡すだけ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { JournalLineTable, type JournalLineTableBulk, type JournalLineTableProps } from './JournalLineTable'
import { DEFAULT_COLUMN_WIDTHS, totalTableWidth } from './journalLineTableColumns'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

function line(id: number, entryId: number, side: 'debit' | 'credit', accountId: number, amount: number): JournalLine {
  return { id, journalEntryId: entryId, accountId, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side, amount, createdAt: '' }
}

function entry(id: number, memo: string, lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: '2026-11-10',
    memo,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

const simple = entry(1, 'コンビニ', [line(11, 1, 'debit', 1, 1280), line(12, 1, 'credit', 2, 1280)])
const compound = entry(2, '給与', [line(21, 2, 'debit', 2, 200), line(22, 2, 'debit', 1, 100), line(23, 2, 'credit', 3, 300)])

const lookup = {
  accountName: (id: number) => ({ 1: '食費', 2: '普通預金', 3: '給与収入' })[id] ?? '',
  projectName: () => '',
  counterpartyName: () => '',
  batchName: () => '',
  memberName: () => '太郎',
}

function makeBulk(overrides: Partial<JournalLineTableBulk> = {}): JournalLineTableBulk {
  return { selectedLineIds: new Set<number>(), disabled: false, onToggleLine: vi.fn(), onToggleSide: vi.fn(), ...overrides }
}

function renderTable(bulk: JournalLineTableBulk | undefined, extra: Partial<JournalLineTableProps> = {}) {
  const onSelect = vi.fn()
  const view = render(<JournalLineTable entries={[simple, compound]} lookup={lookup} selectedId={null} onSelect={onSelect} bulk={bulk} {...extra} />)
  return { ...view, onSelect }
}

function rowsOf(container: HTMLElement, entryId: number): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`tbody[data-entry-id="${entryId}"] tr:not(.journal-line-table__bar)`))
}

describe('JournalLineTable(一括編集の行選択)', () => {
  it('bulk を渡さなければ、チェックボックスは出ない', () => {
    renderTable(undefined)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('明細1行ごとに、借方側・貸方側の先頭にチェックボックスが出る。複合仕訳の足りない側の空欄には出ない', () => {
    const { container } = renderTable(makeBulk())
    // 仕訳1: 借方1・貸方1。仕訳2: 借方2・貸方1(2行目の貸方は空欄)
    expect(within(rowsOf(container, 1)[0]).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(rowsOf(container, 2)[0]).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(rowsOf(container, 2)[1]).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(rowsOf(container, 2)[1]).getByRole('checkbox', { name: '借方の行を選択' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: '借方の行を選択' })).toHaveLength(3)
    expect(screen.getAllByRole('checkbox', { name: '貸方の行を選択' })).toHaveLength(2)
  })

  it('チェックの状態は selectedLineIds に従う', () => {
    const { container } = renderTable(makeBulk({ selectedLineIds: new Set([12, 22]) }))
    expect(within(rowsOf(container, 1)[0]).getByRole('checkbox', { name: '借方の行を選択' })).not.toBeChecked()
    expect(within(rowsOf(container, 1)[0]).getByRole('checkbox', { name: '貸方の行を選択' })).toBeChecked()
    expect(within(rowsOf(container, 2)[1]).getByRole('checkbox', { name: '借方の行を選択' })).toBeChecked()
  })

  it('選択した行のセルは強調される', () => {
    const { container } = renderTable(makeBulk({ selectedLineIds: new Set([12]) }))
    const row = rowsOf(container, 1)[0]
    const credit = within(row).getByRole('checkbox', { name: '貸方の行を選択' }).closest('td')
    expect(credit).toHaveClass('journal-line-table__cell--bulk-selected')
    expect(within(row).getByRole('checkbox', { name: '借方の行を選択' }).closest('td')).not.toHaveClass('journal-line-table__cell--bulk-selected')
  })

  it('チェックを押すと、その行のIDで onToggleLine が呼ばれ、仕訳の選択(onSelect)にはならない', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(within(rowsOf(container, 2)[1]).getByRole('checkbox', { name: '借方の行を選択' }))
    expect(bulk.onToggleLine).toHaveBeenCalledWith(22)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('見出しのチェックを押すと、その側について onToggleSide が呼ばれる', () => {
    const bulk = makeBulk()
    renderTable(bulk)
    fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
    expect(bulk.onToggleSide).toHaveBeenCalledWith('debit')
    fireEvent.click(screen.getByRole('checkbox', { name: '貸方の行をすべて選択' }))
    expect(bulk.onToggleSide).toHaveBeenCalledWith('credit')
  })

  it('見出しのチェックは、その側の全行が選ばれていればチェック、一部なら中間(indeterminate)、なければ空', () => {
    const none = renderTable(makeBulk())
    const head = () => screen.getByRole('checkbox', { name: '借方の行をすべて選択' }) as HTMLInputElement
    expect(head()).not.toBeChecked()
    expect(head().indeterminate).toBe(false)
    none.unmount()

    const some = renderTable(makeBulk({ selectedLineIds: new Set([11]) }))
    expect(head()).not.toBeChecked()
    expect(head().indeterminate).toBe(true)
    some.unmount()

    renderTable(makeBulk({ selectedLineIds: new Set([11, 21, 22]) }))
    expect(head()).toBeChecked()
    expect(head().indeterminate).toBe(false)
  })

  it('押せない状態(disabled)のときは、すべてのチェックボックスが押せない', () => {
    renderTable(makeBulk({ disabled: true }))
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled()
  })

  it('編集中の仕訳の行には、チェックボックスは出ない', () => {
    const { container } = renderTable(makeBulk(), {
      editing: {
        entryId: 1,
        value: { entryDate: '2026-11-10', memo: 'コンビニ', comment: '', householdMemberId: 1, lines: [] },
        onChange: vi.fn(),
        master: { accounts: [], accountCategories: [], counterpartyCategories: [], projectCategories: [], members: [], batches: [] },
        busy: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onDelete: vi.fn(),
        onDeleteCancel: vi.fn(),
        deleteArmed: false,
      },
    })
    expect(within(rowsOf(container, 1)[0]).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(rowsOf(container, 2)[0]).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('編集中の行では、選択の列の分の空白を作らず、科目の選択欄がその分まで広がる(科目のセルが2列分)', () => {
    const { container } = renderTable(makeBulk(), {
      editing: {
        entryId: 1,
        value: {
          entryDate: '2026-11-10',
          memo: 'コンビニ',
          comment: '',
          householdMemberId: 1,
          lines: [
            { key: 1, line: { side: 'debit', accountId: 1, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, amountInput: '1280' } },
            { key: 2, line: { side: 'credit', accountId: 2, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, amountInput: '1280' } },
          ],
        },
        onChange: vi.fn(),
        master: { accounts: [], accountCategories: [], counterpartyCategories: [], projectCategories: [], members: [], batches: [] },
        busy: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onDelete: vi.fn(),
        onDeleteCancel: vi.fn(),
        deleteArmed: false,
      },
    })
    const row = rowsOf(container, 1)[0]
    expect(row.querySelectorAll('td.journal-line-table__cell--check')).toHaveLength(0)
    expect(within(row).getByRole('button', { name: /^借方の科目/ }).closest('td')).toHaveAttribute('colspan', '2')
    expect(within(row).getByRole('button', { name: /^貸方の科目/ }).closest('td')).toHaveAttribute('colspan', '2')
  })

  it('編集中の取引日の入力欄の幅は、日付と出どころの列の幅の合計で、摘要の入力欄が閲覧の行の摘要と同じ位置から始まる', () => {
    const { container } = renderTable(undefined, {
      editing: {
        entryId: 1,
        value: { entryDate: '2026-11-10', memo: 'コンビニ', comment: '', householdMemberId: 1, lines: [] },
        onChange: vi.fn(),
        master: { accounts: [], accountCategories: [], counterpartyCategories: [], projectCategories: [], members: [], batches: [] },
        busy: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
        onDelete: vi.fn(),
        onDeleteCancel: vi.fn(),
        deleteArmed: false,
      },
    })
    const date = container.querySelector('.journal-line-table__edit-date') as HTMLElement
    expect(date.style.flexBasis).toBe(`${DEFAULT_COLUMN_WIDTHS.date + DEFAULT_COLUMN_WIDTHS.source}px`)
  })

  it('選択の列には列幅のつまみがなく、表の最小幅には選択の列(借方・貸方の2列、各32px)が加わる', () => {
    const { container } = renderTable(makeBulk())
    expect(screen.getAllByRole('separator')).toHaveLength(14)
    expect(container.querySelector('table')).toHaveStyle({ minWidth: `${totalTableWidth(DEFAULT_COLUMN_WIDTHS) + 64}px` })
    // 日付〜コメントの4列 + (選択+5列) × 2
    expect(container.querySelectorAll('col')).toHaveLength(16)
  })
})
