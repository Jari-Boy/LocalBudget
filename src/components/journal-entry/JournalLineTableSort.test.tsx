// @vitest-environment jsdom
/**
 * 仕訳一覧の「明細行単位」の表(JournalLineTable)の、列見出しでの並び替え(計画Issue #302)のコンポーネントテスト。
 * sort を渡すと、日付・出どころ・摘要・コメントと、借方・貸方それぞれの科目・プロジェクト・取引先・精算バッチ・世帯メンバー・金額の
 * 見出しに並び替えボタンが付き(チェックの列には付かない)、押すと列のキーが onSort に渡ること、並んでいる列の見出しだけが
 * aria-sort で昇順・降順を伝えること、固定ヘッダーの複製(aria-hidden)のボタンは操作・読み上げの対象にならず見出しが二重にならないこと、
 * 列幅のつまみと並び替えボタンが同じ見出しに同居しても互いに反応しないことを検証する。sort を渡さない呼び出しでは今までどおりボタンは付かない。
 * 外部依存なし(表示用の名前解決関数と JournalEntry を渡すだけ)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { JournalLineTable, type JournalLineTableLookup } from './JournalLineTable'
import type { JournalSort } from './journalEntrySort'

afterEach(cleanup)

const lookup: JournalLineTableLookup = {
  accountName: (id) => ({ 1: '食費', 2: '普通預金' })[id] ?? '',
  projectName: () => '',
  counterpartyName: () => '',
  batchName: () => '',
  memberName: () => '太郎',
}

const line = (id: number, side: 'debit' | 'credit', accountId: number): JournalLine => ({
  id,
  journalEntryId: 1,
  accountId,
  projectId: null,
  householdMemberId: 1,
  counterpartyId: null,
  settlementBatchId: null,
  side,
  amount: 1000,
  createdAt: '',
})

const entries: JournalEntry[] = [
  {
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
    lines: [line(11, 'debit', 1), line(12, 'credit', 2)],
  },
]

function renderTable(sort: JournalSort | null = null, onSort = vi.fn(), withSort = true) {
  const view = render(
    <JournalLineTable
      entries={entries}
      lookup={lookup}
      selectedId={null}
      onSelect={vi.fn()}
      sort={withSort ? { current: sort, onSort } : undefined}
      bulk={{ selectedLineIds: new Set(), disabled: false, onChangeSelection: vi.fn(), onToggleSide: vi.fn(), onToggleEntry: vi.fn() }}
    />,
  )
  return { ...view, onSort }
}

const sortOf = (key: JournalSort['key'], direction: 'asc' | 'desc'): JournalSort => ({ key, direction, values: new Map() })

describe('JournalLineTable(列見出しでの並び替え)', () => {
  it('左側の4列(日付・出どころ・摘要・コメント)に並び替えボタンが付き、押すとその列のキーが渡る', () => {
    const { onSort } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: '日付' }))
    fireEvent.click(screen.getByRole('button', { name: '出どころ' }))
    fireEvent.click(screen.getByRole('button', { name: '摘要' }))
    fireEvent.click(screen.getByRole('button', { name: 'コメント' }))
    expect(onSort.mock.calls.map((c) => c[0])).toEqual(['date', 'source', 'memo', 'comment'])
  })

  it('借方・貸方の同じ名前の列は、側を区別したキーで渡る', () => {
    const { onSort } = renderTable()
    const accountButtons = screen.getAllByRole('button', { name: '科目' })
    expect(accountButtons).toHaveLength(2)
    fireEvent.click(accountButtons[0])
    fireEvent.click(accountButtons[1])
    const amountButtons = screen.getAllByRole('button', { name: '金額' })
    fireEvent.click(amountButtons[0])
    fireEvent.click(amountButtons[1])
    expect(onSort.mock.calls.map((c) => c[0])).toEqual(['debit-account', 'credit-account', 'debit-amount', 'credit-amount'])
  })

  it('借方・貸方の5列すべて(科目・プロジェクト・取引先・精算バッチ・世帯メンバー・金額)が並び替えできる', () => {
    renderTable()
    for (const name of ['科目', 'プロジェクト', '取引先・精算バッチ', '世帯メンバー', '金額']) {
      expect(screen.getAllByRole('button', { name })).toHaveLength(2)
    }
  })

  it('並んでいる列の見出しだけが aria-sort で昇順・降順を伝え、ほかの列は none', () => {
    renderTable(sortOf('debit-account', 'desc'))
    const [debitAccount, creditAccount] = screen.getAllByRole('columnheader', { name: /^科目/ })
    expect(debitAccount).toHaveAttribute('aria-sort', 'descending')
    expect(creditAccount).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: /^日付/ })).toHaveAttribute('aria-sort', 'none')
  })

  it('チェックの列(各側の全選択)には並び替えボタンが付かない', () => {
    renderTable()
    expect(screen.queryByRole('button', { name: /すべて選択/ })).toBeNull()
    expect(screen.getByRole('checkbox', { name: '借方の行をすべて選択' })).toBeInTheDocument()
  })

  it('固定ヘッダーの複製は aria-hidden なので、並び替えボタンも見出しも二重に見つからない', () => {
    renderTable()
    // 複製(floating-table-header)には同じボタンがあるが、固定していない間は aria-hidden で、ロールでは1つだけ
    expect(document.querySelectorAll('.floating-table-header .table-sort').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '日付' })).toHaveLength(1)
    expect(screen.getAllByRole('columnheader', { name: /^日付/ })).toHaveLength(1)
  })

  it('列幅のつまみを押す・キーボードで動かしても並び替えは起きず、並び替えボタンを押しても列幅は変わらない', () => {
    const { onSort } = renderTable()
    const handle = screen.getByRole('separator', { name: '日付の列幅' })
    const before = handle.getAttribute('aria-valuenow')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.doubleClick(handle)
    expect(onSort).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '日付' }))
    expect(onSort).toHaveBeenCalledTimes(1)
    expect(handle.getAttribute('aria-valuenow')).toBe(before)
  })

  it('sort を渡さないときは、並び替えボタンは付かない(従来どおり)', () => {
    renderTable(null, vi.fn(), false)
    expect(screen.queryByRole('button', { name: '日付' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /^日付/ })).not.toHaveAttribute('aria-sort')
  })
})
