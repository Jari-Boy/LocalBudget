// @vitest-environment jsdom
/**
 * 明細行単位の表(JournalLineTable)の一括編集のための行選択(計画Issue #182)のコンポーネントテスト。
 * bulk を渡さなければチェックボックスはないこと、借方・貸方の各側の先頭に明細1行ごとのチェックボックスが出る
 * (足りない側の空欄にはない)こと、選択状態の表示、チェックを押しても仕訳の選択(行を押す操作)にならないこと、
 * 見出しのチェックでその側の全行を選べること(全選択・一部・なしの状態)、押せない状態(disabled)、
 * 編集中の仕訳にはチェックが出ないこと、選択の列が列幅の調整の対象外で表の最小幅に含まれることを検証する。
 * 加えて、1行でも選択している間は、行のどこを押してもチェックの操作になり編集に入らないこと(計画Issue #235 C)を検証する。
 * 外部依存なし(表示用の名前解決関数 lookup と JournalEntry を渡すだけ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
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
  return { selectedLineIds: new Set<number>(), disabled: false, onChangeSelection: vi.fn(), onToggleSide: vi.fn(), onToggleEntry: vi.fn(), ...overrides }
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

  it('チェックを押すと、その行を加えた選択で onChangeSelection が呼ばれ、仕訳の選択(onSelect)にはならない', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(within(rowsOf(container, 2)[1]).getByRole('checkbox', { name: '借方の行を選択' }))
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([22])
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

describe('JournalLineTable(選択中の行クリック)', () => {
  /** 行の中のセルを、セルの並びの順番(0始まり)で得る。日付・出どころ・摘要・コメント → 借方の選択・科目・… → 貸方の選択・科目・… */
  const cellOf = (row: HTMLElement, index: number) => row.querySelectorAll('td')[index] as HTMLElement
  const DEBIT_ACCOUNT = 5
  const CREDIT_ACCOUNT = 11

  it('1行も選択していないときは、行を押すと従来どおり仕訳が選ばれ、チェックの操作は呼ばれない', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT))
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
    expect(bulk.onToggleEntry).not.toHaveBeenCalled()
  })

  it('選択中に借方側のセルを押すと、その借方の行のチェックが切り替わり、編集には入らない', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([21]) })
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT))
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([21, 11])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('選択中に貸方側のセルを押すと、その貸方の行のチェックが切り替わる', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([21]) })
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], CREDIT_ACCOUNT))
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([21, 12])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('複合仕訳の2行目の借方側を押すと、その行(2行目)のチェックが切り替わる', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([11]) })
    const { container } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 2)[1], DEBIT_ACCOUNT))
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([11, 22])
  })

  it('選択中に、日付・摘要などの左側を押すと、その仕訳の全明細行を切り替える(onToggleEntry)', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([21]) })
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], 0))
    expect(bulk.onToggleEntry).toHaveBeenCalledWith(1)
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('選択中に摘要のボタンを押しても、編集には入らず、その仕訳の全明細行の切り替えになる', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([21]) })
    const { onSelect } = renderTable(bulk)
    fireEvent.click(screen.getByRole('button', { name: 'コンビニ' }))
    expect(bulk.onToggleEntry).toHaveBeenCalledWith(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('複合仕訳の足りない側の空欄を押しても、何も呼ばれない', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([11]) })
    const { container, onSelect } = renderTable(bulk)
    // 仕訳2の2行目は貸方が空欄(貸方側のセルは、左4列+借方6列の次から)
    fireEvent.click(cellOf(rowsOf(container, 2)[1], CREDIT_ACCOUNT))
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
    expect(bulk.onToggleEntry).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('押せない状態(disabled)のときは、選択中に行を押しても何も呼ばれない', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([11]), disabled: true })
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT))
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
    expect(bulk.onToggleEntry).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('チェックボックスを直接押したときは、行の切り替えと二重にならず、1回だけ呼ばれる', () => {
    const bulk = makeBulk({ selectedLineIds: new Set([11]) })
    const { container } = renderTable(bulk)
    fireEvent.click(within(rowsOf(container, 1)[0]).getByRole('checkbox', { name: '貸方の行を選択' }))
    expect(bulk.onChangeSelection).toHaveBeenCalledTimes(1)
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([11, 12])
  })
})

/**
 * 範囲選択・トグル選択(計画Issue #235 D): 共通フック useRangeSelection を借方側・貸方側それぞれに適用する。
 * 範囲は同じ側の中だけで、借方と貸方をまたがない。選択の状態を実際に持つ小さな親を使って確認する。
 */
describe('JournalLineTable(Shift/Ctrl による範囲選択・トグル選択)', () => {
  function Stateful({ disabled = false }: { disabled?: boolean }) {
    const [ids, setIds] = useState<ReadonlySet<number>>(new Set())
    const bulk = makeBulk({ selectedLineIds: ids, disabled, onChangeSelection: (next) => setIds(new Set(next)) })
    return <JournalLineTable entries={[simple, compound]} lookup={lookup} selectedId={null} onSelect={vi.fn()} bulk={bulk} />
  }

  const cellOf = (row: HTMLElement, index: number) => row.querySelectorAll('td')[index] as HTMLElement

  /** 借方の行のチェックボックス(表示順: 仕訳1の行11、仕訳2の行21・22) */
  const debitBoxes = () => screen.getAllByRole('checkbox', { name: '借方の行を選択' })
  /** 貸方の行のチェックボックス(表示順: 仕訳1の行12、仕訳2の行23) */
  const creditBoxes = () => screen.getAllByRole('checkbox', { name: '貸方の行を選択' })
  const checkedOf = (boxes: HTMLElement[]) => boxes.map((box) => (box as HTMLInputElement).checked)

  it('借方の1行目のチェックから、Shift+クリックで借方の3行目までを範囲選択できる(仕訳をまたぐ)', () => {
    render(<Stateful />)
    fireEvent.click(debitBoxes()[0])
    fireEvent.click(debitBoxes()[2], { shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, true, true])
    expect(checkedOf(creditBoxes())).toEqual([false, false])
  })

  it('範囲選択は同じ側の中だけで、借方から貸方へ Shift+クリックしても、貸方のその行だけが選ばれる', () => {
    render(<Stateful />)
    fireEvent.click(debitBoxes()[0])
    fireEvent.click(creditBoxes()[1], { shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, false, false])
    expect(checkedOf(creditBoxes())).toEqual([false, true])
  })

  it('Ctrl+クリックは、ほかの選択を保ったまま、その行だけを切り替える', () => {
    render(<Stateful />)
    fireEvent.click(debitBoxes()[0])
    fireEvent.click(debitBoxes()[2], { ctrlKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, false, true])
    fireEvent.click(debitBoxes()[0], { metaKey: true })
    expect(checkedOf(debitBoxes())).toEqual([false, false, true])
  })

  it('チェックボックスではなく、行のセルを Shift+クリックしても、範囲選択になる', () => {
    const { container } = render(<Stateful />)
    fireEvent.click(debitBoxes()[0])
    fireEvent.click(cellOf(rowsOf(container, 2)[1], 5), { shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, true, true])
  })

  it('借方のチェックにフォーカスして Shift+↓ を押すと、次の借方の行(次の仕訳の行)までが選ばれ、フォーカスがそこへ移る', () => {
    render(<Stateful />)
    debitBoxes()[0].focus()
    fireEvent.keyDown(debitBoxes()[0], { key: 'ArrowDown', shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, true, false])
    expect(debitBoxes()[1]).toHaveFocus()
    fireEvent.keyDown(debitBoxes()[1], { key: 'ArrowDown', shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, true, true])
    expect(debitBoxes()[2]).toHaveFocus()
  })

  it('貸方のチェックでの Shift+↓ は、貸方の次の行へ進み、借方の行には移らない', () => {
    render(<Stateful />)
    creditBoxes()[0].focus()
    fireEvent.keyDown(creditBoxes()[0], { key: 'ArrowDown', shiftKey: true })
    expect(checkedOf(creditBoxes())).toEqual([true, true])
    expect(checkedOf(debitBoxes())).toEqual([false, false, false])
    expect(creditBoxes()[1]).toHaveFocus()
  })

  it('Shift+↑ で、広げた範囲を縮められる', () => {
    render(<Stateful />)
    debitBoxes()[0].focus()
    fireEvent.keyDown(debitBoxes()[0], { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(debitBoxes()[1], { key: 'ArrowUp', shiftKey: true })
    expect(checkedOf(debitBoxes())).toEqual([true, false, false])
    expect(debitBoxes()[0]).toHaveFocus()
  })
})

/**
 * Ctrl/Cmd を押したまま行のどこかを押すと、(1行も選んでいない状態でも)編集には入らず、チェックの操作になる
 * (計画Issue #235 D の追加要望)。押した位置の切り分けは、選択中の行クリックと同じ。
 */
describe('JournalLineTable(Ctrl/Cmd+行の押下)', () => {
  const cellOf = (row: HTMLElement, index: number) => row.querySelectorAll('td')[index] as HTMLElement
  const DEBIT_ACCOUNT = 5
  const CREDIT_ACCOUNT = 11

  it('選択がなくても、Ctrl+借方側のセルを押すと、編集には入らず、その借方の行が選択に加わる', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT), { ctrlKey: true })
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([11])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Cmd+貸方側のセルを押すと、その貸方の行が選択に加わる', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], CREDIT_ACCOUNT), { metaKey: true })
    expect(bulk.onChangeSelection).toHaveBeenCalledWith([12])
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Ctrl+日付・摘要などの左側を押すと、その仕訳の全明細行の切り替えになる', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], 0), { ctrlKey: true })
    expect(bulk.onToggleEntry).toHaveBeenCalledWith(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Ctrl+摘要のボタンを押しても、編集には入らず、その仕訳の全明細行の切り替えになる', () => {
    const bulk = makeBulk()
    const { onSelect } = renderTable(bulk)
    fireEvent.click(screen.getByRole('button', { name: 'コンビニ' }), { ctrlKey: true })
    expect(bulk.onToggleEntry).toHaveBeenCalledWith(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Ctrl を押さずに行を押すと、選択がなければ従来どおり編集に入る', () => {
    const bulk = makeBulk()
    const { container, onSelect } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT))
    expect(onSelect).toHaveBeenCalledWith(1)
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
  })

  it('押せない状態(disabled)のときは、Ctrl+行を押しても選択は変わらない', () => {
    const bulk = makeBulk({ disabled: true })
    const { container } = renderTable(bulk)
    fireEvent.click(cellOf(rowsOf(container, 1)[0], DEBIT_ACCOUNT), { ctrlKey: true })
    expect(bulk.onChangeSelection).not.toHaveBeenCalled()
    expect(bulk.onToggleEntry).not.toHaveBeenCalled()
  })
})
