// @vitest-environment jsdom
/**
 * 明細行単位の表(JournalLineTable)の列幅の調整(計画Issue #182)のコンポーネントテスト。
 * 列の境目のつまみ(separator)が日付・出どころ・摘要・コメントと借方・貸方の各列(計14本)にあること、
 * キーボード(←→で増減、Homeで初期値)・ドラッグ・ダブルクリックで列幅が変わること、幅の下限、
 * 借方と貸方の同じ種類の列が連動すること、表の最小幅が列幅の合計に追従すること、
 * 調整した列幅の保存と復元、表の外に置いた「列幅を初期値に戻す」ボタン(列幅の状態は useJournalLineTableColumns で共有)を検証する。
 * 外部依存なし(localStorage は jsdom のものを使い、テストごとに空にする)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { JournalLineTable } from './JournalLineTable'
import { useJournalLineTableColumns } from './useJournalLineTableColumns'
import { DEFAULT_COLUMN_WIDTHS, MIN_COLUMN_WIDTH, totalTableWidth } from './journalLineTableColumns'

const STORAGE_KEY = 'localbudget:journal-line-table-column-widths'

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

const entry: JournalEntry = {
  id: 1,
  entryDate: '2026-11-10',
  memo: 'コンビニ',
  comment: null,
  currency: 'JPY',
  sourceType: 'manual',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [
    { id: 11, journalEntryId: 1, accountId: 1, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'debit', amount: 1280, createdAt: '' },
    { id: 12, journalEntryId: 1, accountId: 2, projectId: null, householdMemberId: 1, counterpartyId: null, settlementBatchId: null, side: 'credit', amount: 1280, createdAt: '' },
  ],
}

const lookup = {
  accountName: (id: number) => (id === 1 ? '食費' : '普通預金'),
  projectName: () => '',
  counterpartyName: () => '',
  batchName: () => '',
  memberName: () => '太郎',
}

/** 画面と同じく、列幅の状態を表の外(画面)で持ち、「列幅を初期値に戻す」ボタンも表の外に置く */
function Harness() {
  const columns = useJournalLineTableColumns()
  return (
    <>
      <button type="button" disabled={columns.isDefault} onClick={columns.resetAll}>
        列幅を初期値に戻す
      </button>
      <JournalLineTable entries={[entry]} lookup={lookup} selectedId={null} onSelect={vi.fn()} columns={columns} />
    </>
  )
}

function renderTable() {
  return render(<Harness />)
}

/** colgroup の col(日付・出どころ・摘要・コメント、借方の5列、貸方の5列の順)の幅 */
function colWidths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('col')).map((c) => c.style.width)
}

const COL = { date: 0, source: 1, memo: 2, comment: 3, debitAccount: 4, creditAccount: 9, creditAmount: 13 }
const handle = (name: string) => screen.getByRole('separator', { name })
const press = (name: string, key: string) => fireEvent.keyDown(handle(name), { key })
const resetButton = () => screen.getByRole('button', { name: '列幅を初期値に戻す' })

describe('JournalLineTable(列幅の調整)', () => {
  it('日付・出どころ・摘要・コメントと、借方・貸方の各5列の境目に、列幅を変えるつまみが全部で14本ある', () => {
    renderTable()
    expect(screen.getAllByRole('separator')).toHaveLength(14)
    for (const name of ['日付の列幅', '出どころの列幅', '摘要の列幅', 'コメントの列幅', '借方の科目の列幅', '貸方の金額の列幅']) {
      expect(handle(name)).toBeInTheDocument()
    }
  })

  it('初期の列幅で表が組まれ、表の最小幅は列幅の合計になる', () => {
    const { container } = renderTable()
    expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
    expect(container.querySelector('table')).toHaveStyle({ minWidth: `${totalTableWidth(DEFAULT_COLUMN_WIDTHS)}px` })
  })

  it('つまみは aria-valuenow・valuemin・valuemax で、いまの幅と範囲を伝える', () => {
    renderTable()
    expect(handle('日付の列幅')).toHaveAttribute('aria-valuenow', String(DEFAULT_COLUMN_WIDTHS.date))
    expect(handle('日付の列幅')).toHaveAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH))
    expect(handle('日付の列幅')).toHaveAttribute('aria-valuemax')
    expect(handle('日付の列幅')).toHaveAttribute('aria-orientation', 'vertical')
  })

  describe('キーボード', () => {
    it('→で広がり、←で狭まる(8pxずつ)。表の最小幅も追従する', () => {
      const { container } = renderTable()
      press('日付の列幅', 'ArrowRight')
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date + 8}px`)
      expect(handle('日付の列幅')).toHaveAttribute('aria-valuenow', String(DEFAULT_COLUMN_WIDTHS.date + 8))
      press('日付の列幅', 'ArrowLeft')
      press('日付の列幅', 'ArrowLeft')
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date - 8}px`)
      expect(container.querySelector('table')).toHaveStyle({
        minWidth: `${totalTableWidth({ ...DEFAULT_COLUMN_WIDTHS, date: DEFAULT_COLUMN_WIDTHS.date - 8 })}px`,
      })
    })

    it('下限より狭くならない', () => {
      const { container } = renderTable()
      for (let i = 0; i < 12; i += 1) press('日付の列幅', 'ArrowLeft')
      expect(colWidths(container)[COL.date]).toBe(`${MIN_COLUMN_WIDTH}px`)
    })

    it('Homeで、その列だけ初期の幅に戻る', () => {
      const { container } = renderTable()
      press('日付の列幅', 'ArrowRight')
      press('摘要の列幅', 'ArrowRight')
      press('日付の列幅', 'Home')
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
      expect(colWidths(container)[COL.memo]).toBe(`${DEFAULT_COLUMN_WIDTHS.memo + 8}px`)
    })

    it('矢印・Home以外のキーでは何も変わらない', () => {
      const { container } = renderTable()
      press('日付の列幅', 'a')
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
    })
  })

  describe('借方と貸方の連動', () => {
    it('借方の「科目」の幅を変えると、貸方の「科目」も同じ幅になる(逆も同じ)', () => {
      const { container } = renderTable()
      press('借方の科目の列幅', 'ArrowRight')
      expect(colWidths(container)[COL.debitAccount]).toBe(`${DEFAULT_COLUMN_WIDTHS.account + 8}px`)
      expect(colWidths(container)[COL.creditAccount]).toBe(`${DEFAULT_COLUMN_WIDTHS.account + 8}px`)
      press('貸方の金額の列幅', 'ArrowLeft')
      expect(colWidths(container)[COL.creditAmount]).toBe(`${DEFAULT_COLUMN_WIDTHS.amount - 8}px`)
      expect(colWidths(container)[COL.creditAmount - 5]).toBe(`${DEFAULT_COLUMN_WIDTHS.amount - 8}px`)
    })
  })

  describe('ドラッグ', () => {
    it('つまみを横にドラッグした分だけ、その列が広がり、離すと保存される', () => {
      const { container } = renderTable()
      const sep = handle('日付の列幅')
      fireEvent.pointerDown(sep, { clientX: 100, pointerId: 1, button: 0 })
      fireEvent.pointerMove(sep, { clientX: 150, pointerId: 1 })
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date + 50}px`)
      fireEvent.pointerUp(sep, { clientX: 150, pointerId: 1 })
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').date).toBe(DEFAULT_COLUMN_WIDTHS.date + 50)
    })

    it('押していない間に動かしても、列幅は変わらない', () => {
      const { container } = renderTable()
      fireEvent.pointerMove(handle('日付の列幅'), { clientX: 300, pointerId: 1 })
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
    })

    it('下限より狭くなるまでドラッグしても、下限で止まる', () => {
      const { container } = renderTable()
      const sep = handle('日付の列幅')
      fireEvent.pointerDown(sep, { clientX: 500, pointerId: 1, button: 0 })
      fireEvent.pointerMove(sep, { clientX: 0, pointerId: 1 })
      expect(colWidths(container)[COL.date]).toBe(`${MIN_COLUMN_WIDTH}px`)
    })

    it('つまみをダブルクリックすると、その列だけ初期の幅に戻る', () => {
      const { container } = renderTable()
      press('日付の列幅', 'ArrowRight')
      press('摘要の列幅', 'ArrowRight')
      fireEvent.doubleClick(handle('日付の列幅'))
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
      expect(colWidths(container)[COL.memo]).toBe(`${DEFAULT_COLUMN_WIDTHS.memo + 8}px`)
    })
  })

  describe('保存と復元', () => {
    it('調整した列幅をlocalStorageに保存する', () => {
      renderTable()
      press('摘要の列幅', 'ArrowRight')
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').memo).toBe(DEFAULT_COLUMN_WIDTHS.memo + 8)
    })

    it('保存された列幅で、再訪時に表を組む', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ memo: 300 }))
      const { container } = renderTable()
      expect(colWidths(container)[COL.memo]).toBe('300px')
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
    })
  })

  it('列幅の状態を渡さなければ、表自身が持つ(表の中には「列幅を初期値に戻す」ボタンはない)', () => {
    render(<JournalLineTable entries={[entry]} lookup={lookup} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '列幅を初期値に戻す' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(14)
  })

  describe('「列幅を初期値に戻す」ボタン(表の外から操作する)', () => {
    it('初期の列幅のままのときは押せない', () => {
      renderTable()
      expect(resetButton()).toBeDisabled()
    })

    it('列幅を変えると押せるようになり、押すとすべての列が初期の幅に戻って保存も消える', () => {
      const { container } = renderTable()
      press('日付の列幅', 'ArrowRight')
      press('借方の科目の列幅', 'ArrowRight')
      expect(resetButton()).toBeEnabled()
      fireEvent.click(resetButton())
      expect(colWidths(container)[COL.date]).toBe(`${DEFAULT_COLUMN_WIDTHS.date}px`)
      expect(colWidths(container)[COL.debitAccount]).toBe(`${DEFAULT_COLUMN_WIDTHS.account}px`)
      expect(colWidths(container)[COL.creditAccount]).toBe(`${DEFAULT_COLUMN_WIDTHS.account}px`)
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
      expect(resetButton()).toBeDisabled()
    })
  })
})
