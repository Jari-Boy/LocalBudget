// @vitest-environment jsdom
/**
 * 仕訳一覧の「明細行単位」の表(JournalLineTable、計画Issue #182)のコンポーネントテスト(閲覧表示)。
 * 列見出し(借方・貸方の各5列と日付・出どころ・摘要・コメント)、借方を左・貸方を右に行番号で対応づけた行、
 * 複合仕訳(3行以上)の全行表示と空欄、日付・出どころ・摘要・コメントが仕訳の先頭行だけであること、
 * 付帯項目(プロジェクト・取引先または精算バッチ・世帯メンバー)の表示(取引先と精算バッチは科目によって
 * どちらか一方しか持てないため1列にまとめる)、どの行を押しても仕訳単位で選択されること(編集ボタンはない)、
 * 仕訳がないときの表示を検証する。
 * 外部依存なし(表示用の名前解決関数 lookup と JournalEntry を渡すだけ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { formatDate } from '../../infrastructure/i18n/formatDate'
import { JournalLineTable, type JournalLineTableLookup } from './JournalLineTable'

afterEach(cleanup)

const lookup: JournalLineTableLookup = {
  accountName: (id) => ({ 1: '食費', 2: '普通預金', 3: '給与収入', 4: '社会保険料', 5: '所得税' })[id] ?? '(不明な科目)',
  projectName: (id) => (id === 10 ? '自宅' : ''),
  counterpartyName: (id) => (id === 20 ? 'セブンイレブン' : ''),
  batchName: (id) => (id === 30 ? '11月の割勘' : ''),
  memberName: (id) => ({ 1: '太郎', 2: '花子' })[id] ?? '',
}

function line(
  id: number,
  entryId: number,
  side: 'debit' | 'credit',
  accountId: number,
  amount: number,
  extra: Partial<JournalLine> = {},
): JournalLine {
  return {
    id,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
    ...extra,
  }
}

function entry(id: number, date: string, memo: string | null, lines: JournalLine[], comment: string | null = null): JournalEntry {
  return {
    id,
    entryDate: date,
    memo,
    comment,
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

const simple = entry(
  1,
  '2026-11-10',
  'コンビニ',
  [line(11, 1, 'debit', 1, 1280, { projectId: 10, counterpartyId: 20 }), line(12, 1, 'credit', 2, 1280, { householdMemberId: 2 })],
  '朝食',
)
const compound = entry(2, '2026-11-08', '給与 11月分', [
  line(21, 2, 'debit', 2, 245300),
  line(22, 2, 'debit', 4, 32400),
  line(23, 2, 'debit', 5, 22300),
  line(24, 2, 'credit', 3, 300000),
])
const split = entry(3, '2026-11-03', '夕食', [
  line(31, 3, 'debit', 1, 3200, { settlementBatchId: 30 }),
  line(32, 3, 'credit', 2, 3200),
])

function renderTable(overrides: Partial<Parameters<typeof JournalLineTable>[0]> = {}) {
  const props = {
    entries: [simple, compound, split],
    lookup,
    selectedId: null,
    onSelect: vi.fn(),
    ...overrides,
  }
  const view = render(<JournalLineTable {...props} />)
  return { ...view, props }
}

/** 1つの仕訳の表の行(tbody の tr)。仕訳ごとに tbody を分けている */
function rowsOf(container: HTMLElement, entryId: number): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`tbody[data-entry-id="${entryId}"] tr`))
}

describe('JournalLineTable(閲覧)', () => {
  it('列見出しに、日付・出どころ・摘要・コメントと、借方・貸方それぞれの科目・プロジェクト・取引先・精算バッチ・世帯メンバー・金額がある', () => {
    renderTable()
    for (const name of ['日付', '出どころ', '摘要', 'コメント']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('columnheader', { name: '借方' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '貸方' })).toBeInTheDocument()
    // 取引先と精算バッチはどちらか一方しか持てないため、1列にまとめている
    for (const name of ['科目', 'プロジェクト', '取引先・精算バッチ', '世帯メンバー', '金額']) {
      expect(screen.getAllByRole('columnheader', { name })).toHaveLength(2)
    }
    expect(screen.queryByRole('columnheader', { name: '取引先' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '精算バッチ' })).not.toBeInTheDocument()
  })

  it('借方1行・貸方1行の仕訳は1行になり、借方が左・貸方が右に並ぶ', () => {
    const { container } = renderTable()
    const rows = rowsOf(container, 1)
    expect(rows).toHaveLength(1)
    const cells = within(rows[0]).getAllByRole('cell').map((c) => c.textContent)
    // 日付・出どころ・摘要・コメント | 借方(科目…金額) | 貸方(科目…金額)
    expect(cells.indexOf('食費')).toBeLessThan(cells.indexOf('普通預金'))
    expect(cells.filter((c) => c === formatCurrency(1280, 'JPY'))).toHaveLength(2)
  })

  it('複合仕訳(借方3行・貸方1行)は3行すべて表示され、貸方の足りない行は空欄になる', () => {
    const { container } = renderTable()
    const rows = rowsOf(container, 2)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('普通預金')).toBeInTheDocument()
    expect(within(rows[1]).getByText('社会保険料')).toBeInTheDocument()
    expect(within(rows[2]).getByText('所得税')).toBeInTheDocument()
    expect(within(rows[0]).getByText('給与収入')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('給与収入')).not.toBeInTheDocument()
    expect(within(rows[2]).queryByText('給与収入')).not.toBeInTheDocument()
  })

  it('日付・出どころ・摘要・コメントは仕訳の先頭行にだけ表示される', () => {
    const { container } = renderTable()
    const first = rowsOf(container, 2)[0]
    const second = rowsOf(container, 2)[1]
    expect(within(first).getByText('給与 11月分')).toBeInTheDocument()
    expect(within(first).getByText('手入力')).toBeInTheDocument()
    const date = formatDate(new Date(2026, 10, 8))
    expect(within(first).getByText(date)).toBeInTheDocument()
    expect(within(second).queryByText('給与 11月分')).not.toBeInTheDocument()
    expect(within(second).queryByText('手入力')).not.toBeInTheDocument()
    expect(within(second).queryByText(date)).not.toBeInTheDocument()
    expect(within(rowsOf(container, 1)[0]).getByText('朝食')).toBeInTheDocument()
  })

  it('付帯項目(プロジェクト・取引先・精算バッチ・世帯メンバー)が借方・貸方の行ごとに表示される', () => {
    const { container } = renderTable()
    const first = within(rowsOf(container, 1)[0])
    expect(first.getByText('自宅')).toBeInTheDocument()
    expect(first.getByText('セブンイレブン')).toBeInTheDocument()
    expect(first.getByText('花子')).toBeInTheDocument()
    expect(first.getByText('太郎')).toBeInTheDocument()
    expect(within(rowsOf(container, 3)[0]).getByText('11月の割勘')).toBeInTheDocument()
  })

  it('取引先と精算バッチは、同じ「取引先・精算バッチ」の列に出る', () => {
    const { container } = renderTable()
    const cellsOf = (id: number) => within(rowsOf(container, id)[0]).getAllByRole('cell').map((c) => c.textContent)
    // 借方側の「取引先・精算バッチ」は、借方の先頭(科目)から数えて3列目
    const partnerIndex = (id: number) => cellsOf(id).indexOf('食費') + 2
    expect(cellsOf(1)[partnerIndex(1)]).toBe('セブンイレブン')
    expect(cellsOf(3)[partnerIndex(3)]).toBe('11月の割勘')
  })

  it('摘要がない仕訳は「(摘要なし)」と表示される', () => {
    const { container } = renderTable({ entries: [entry(9, '2026-11-01', null, [line(91, 9, 'debit', 1, 100), line(92, 9, 'credit', 2, 100)])] })
    expect(within(rowsOf(container, 9)[0]).getByText('(摘要なし)')).toBeInTheDocument()
  })

  it('複合仕訳の2行目など、どの行を押しても、その仕訳が選択される(仕訳単位)', () => {
    const { container, props } = renderTable()
    fireEvent.click(within(rowsOf(container, 2)[1]).getByText('社会保険料'))
    expect(props.onSelect).toHaveBeenCalledWith(2)
  })

  it('摘要のボタンを押しても、その仕訳が選択される(キーボードでも操作できる入口)', () => {
    const { props } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'コンビニ' }))
    expect(props.onSelect).toHaveBeenCalledWith(1)
  })

  it('選択中の仕訳のすべての行に aria-current が付く', () => {
    const { container } = renderTable({ selectedId: 2 })
    for (const row of rowsOf(container, 2)) expect(row).toHaveAttribute('aria-current', 'true')
    for (const row of rowsOf(container, 1)) expect(row).not.toHaveAttribute('aria-current')
  })

  it('「編集」ボタンはない(行を選ぶと編集できるため)', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: /編集/ })).not.toBeInTheDocument()
  })

  it('仕訳がないときは、該当する仕訳がない旨を表示する', () => {
    renderTable({ entries: [] })
    expect(screen.getByText('該当する仕訳がありません')).toBeInTheDocument()
  })
})
