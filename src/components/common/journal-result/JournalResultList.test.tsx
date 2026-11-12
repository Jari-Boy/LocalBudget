// @vitest-environment jsdom
/**
 * 仕訳の結果一覧(JournalResultList)のコンポーネントテスト(計画Issue #150)。
 * 1仕訳1行の要約(出どころタグ・摘要・金額・日付・借方→貸方の代表科目)を表示し、
 * 選択なし・単一・複数を切り替えられること、↑↓キーで移動できることを検証する。
 * 計画Issue #164で、承認待ちの定期仕訳タブ向けに、科目を出さない(hideAccounts)・日付のあとに補足(note)を出す・
 * 詳細の選択とは別のチェックボックス(checkable)を付けられることも検証する。
 * 外部依存なし(表示用に整形済みの行データ JournalResultItem だけを受け取る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JournalResultList, type SelectionMode } from './JournalResultList'
import type { JournalResultItem } from './journalResultModel'

afterEach(cleanup)

const items: JournalResultItem[] = [
  {
    id: 1,
    sourceType: 'external_import',
    memo: 'セブンイレブン',
    amount: 1280,
    currency: 'JPY',
    entryDate: '2026-10-05',
    debitSummary: '食費 ほか1件',
    creditSummary: '楽天カード',
  },
  {
    id: 2,
    sourceType: 'manual',
    memo: '家賃',
    amount: 80000,
    currency: 'JPY',
    entryDate: '2026-10-01',
    debitSummary: '家賃',
    creditSummary: '普通預金',
  },
  {
    id: 3,
    sourceType: 'expense_splitting',
    memo: '夕食',
    amount: 4000,
    currency: 'JPY',
    entryDate: '2026-09-30',
    debitSummary: '立替金',
    creditSummary: '食費',
  },
]

function Harness({
  mode,
  initial = [],
  onChange,
}: {
  mode: SelectionMode
  initial?: number[]
  onChange?: (ids: readonly number[]) => void
}) {
  const [ids, setIds] = useState<readonly number[]>(initial)
  return (
    <JournalResultList
      items={items}
      selectionMode={mode}
      selectedIds={ids}
      onSelectionChange={(next) => {
        setIds(next)
        onChange?.(next)
      }}
    />
  )
}

const list = () => screen.getByRole('group', { name: '仕訳一覧。上下キーで選択を移動' })

describe('JournalResultList(表示)', () => {
  it('1仕訳1行で、出どころタグ・摘要・金額・日付・借方→貸方を表示する', () => {
    render(<Harness mode="none" />)
    const first = within(list()).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('外部明細')
    expect(first).toHaveTextContent('セブンイレブン')
    expect(first).toHaveTextContent(/1,280/)
    expect(first).toHaveTextContent('2026/10/5')
    expect(first).toHaveTextContent('食費 ほか1件 → 楽天カード')
    expect(within(list()).getAllByRole('listitem')).toHaveLength(3)
  })

  it('行がないときは「該当する仕訳がありません」を表示する', () => {
    render(
      <JournalResultList items={[]} selectionMode="none" selectedIds={[]} onSelectionChange={() => {}} />,
    )
    expect(screen.getByText('該当する仕訳がありません')).toBeInTheDocument()
  })

  it('選択なしのモードでは行を押せない(ボタンもチェックボックスも出ない)', () => {
    render(<Harness mode="none" />)
    expect(within(list()).queryByRole('button')).toBeNull()
    expect(within(list()).queryByRole('checkbox')).toBeNull()
  })
})

describe('JournalResultList(単一選択)', () => {
  it('行を押すとその仕訳だけが選択され、aria-currentで示される', () => {
    const onChange = vi.fn()
    render(<Harness mode="single" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
    expect(onChange).toHaveBeenLastCalledWith([2])
    expect(screen.getByRole('button', { name: /家賃/ })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: /夕食/ }))
    expect(onChange).toHaveBeenLastCalledWith([3])
    expect(screen.getByRole('button', { name: /家賃/ })).not.toHaveAttribute('aria-current')
  })

  it('↓↑キーで選択を移動し、端では止まる', () => {
    const onChange = vi.fn()
    render(<Harness mode="single" initial={[1]} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /セブンイレブン/ }), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith([2])
    fireEvent.keyDown(screen.getByRole('button', { name: /家賃/ }), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith([3])
    onChange.mockClear()
    fireEvent.keyDown(screen.getByRole('button', { name: /夕食/ }), { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('button', { name: /夕食/ }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith([2])
  })

  it('何も選択していない状態で↓を押すと先頭の仕訳を選択する', () => {
    const onChange = vi.fn()
    render(<Harness mode="single" onChange={onChange} />)
    fireEvent.keyDown(list(), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith([1])
  })

  it('キーで移動した行にフォーカスも移る', () => {
    render(<Harness mode="single" initial={[1]} />)
    fireEvent.keyDown(screen.getByRole('button', { name: /セブンイレブン/ }), { key: 'ArrowDown' })
    expect(screen.getByRole('button', { name: /家賃/ })).toHaveFocus()
  })
})

describe('JournalResultList(複数選択)', () => {
  it('各行がチェックボックスになり、押すたびに選択・解除を切り替える', () => {
    const onChange = vi.fn()
    render(<Harness mode="multiple" onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /セブンイレブン/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /夕食/ }))
    expect(onChange).toHaveBeenLastCalledWith([1, 3])
    expect(screen.getByRole('checkbox', { name: /夕食/ })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /セブンイレブン/ }))
    expect(onChange).toHaveBeenLastCalledWith([3])
  })

  it('↓↑キーでは選択を変えずにフォーカスだけを移動する', () => {
    const onChange = vi.fn()
    render(<Harness mode="multiple" onChange={onChange} />)
    const first = screen.getByRole('checkbox', { name: /セブンイレブン/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('checkbox', { name: /家賃/ })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(first).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('JournalResultList(承認待ちの定期仕訳で使う拡張、計画Issue #164)', () => {
  it('hideAccounts のとき、科目(借方→貸方)は表示せず、日付は表示する。指定しなければ従来どおり表示する', () => {
    const { rerender } = render(
      <JournalResultList items={items} selectionMode="single" selectedIds={[]} onSelectionChange={() => {}} hideAccounts />,
    )
    const first = within(list()).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('2026/10/5')
    expect(first).not.toHaveTextContent('食費 ほか1件')
    expect(first).not.toHaveTextContent('→')

    rerender(<JournalResultList items={items} selectionMode="single" selectedIds={[]} onSelectionChange={() => {}} />)
    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('食費 ほか1件 → 楽天カード')
  })

  it('note があれば、日付のあとに表示する', () => {
    render(
      <JournalResultList
        items={[{ ...items[0], note: '期日10/25(日)を前の平日に' }]}
        selectionMode="single"
        selectedIds={[]}
        onSelectionChange={() => {}}
        hideAccounts
      />,
    )

    expect(within(list()).getAllByRole('listitem')[0]).toHaveTextContent('2026/10/5 ・ 期日10/25(日)を前の平日に')
  })

  it('checkable のとき、各行に選択とは別のチェックボックスが付き、チェック済みの行はオンになる', () => {
    render(
      <JournalResultList
        items={items}
        selectionMode="single"
        selectedIds={[]}
        onSelectionChange={() => {}}
        checkable={{ checkedIds: [2], onToggle: () => {} }}
      />,
    )

    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.getByRole('checkbox', { name: /家賃/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /セブンイレブン/ })).not.toBeChecked()
  })

  it('checkable のとき、チェックボックスを押すと、選択(詳細表示)は変えずに、そのチェックの切り替えだけを通知する', () => {
    const onToggle = vi.fn()
    const onSelectionChange = vi.fn()
    render(
      <JournalResultList
        items={items}
        selectionMode="single"
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
        checkable={{ checkedIds: [], onToggle }}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /夕食/ }))

    expect(onToggle).toHaveBeenCalledWith(3)
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('checkable のとき、行を押すと従来どおり選択だけが変わり、チェックの切り替えは通知しない', () => {
    const onToggle = vi.fn()
    const onSelectionChange = vi.fn()
    render(
      <JournalResultList
        items={items}
        selectionMode="single"
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
        checkable={{ checkedIds: [], onToggle }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /家賃/ }))

    expect(onSelectionChange).toHaveBeenCalledWith([2])
    expect(onToggle).not.toHaveBeenCalled()
  })
})
