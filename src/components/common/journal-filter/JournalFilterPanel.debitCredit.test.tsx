// @vitest-environment jsdom
/**
 * 仕訳の絞り込みパネル(JournalFilterPanel)の、計画Issue #314の変更のコンポーネントテスト。
 * (1) 「借方・貸方を分けて検索」のチェックで、科目・取引先・プロジェクト・世帯メンバー・精算バッチが借方・貸方の2つのまとまりに
 * 分かれ、それぞれ debit / credit の条件として通知されること、切り替えると競合する条件が消えること、借方・貸方の条件を持つ
 * 条件で開くとはじめから分けた状態になること、出どころは分かれないこと、(2) 期間が「日付で指定」のチェックで日付・月を
 * 切り替えられること、(3) 金額のスライダー(キーボード)で金額の範囲が通知されること、(4) 出どころが摘要の隣にあること、
 * (5) 「条件をクリア」がアイコンつきのボタンであることを検証する。外部依存なし。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { JournalFilterPanel, type JournalFilterOptions } from './JournalFilterPanel'

afterEach(cleanup)

const flat = (items: { value: string; name: string }[]) => [
  { key: 'flat', name: '', nodes: items.map((i) => ({ kind: 'item' as const, ...i, isActive: true })) },
]

const options: JournalFilterOptions = {
  accountCategories: flat([
    { value: '9', name: '雑費' },
    { value: '1', name: '外食' },
  ]),
  counterpartyCategories: flat([{ value: '2', name: 'ローソン' }]),
  projectCategories: flat([{ value: '3', name: '帰省' }]),
  members: [{ value: '4', name: '太郎' }],
  batches: [{ value: '6', name: '10月分' }],
  sourceTypes: [{ value: 'manual', name: '手入力' }],
  entryDates: ['2026-09-15', '2026-11-03'],
  maxAmount: 300000,
}

function Harness({
  initial = {},
  onFilter,
  hide,
}: {
  initial?: JournalEntryFilter
  onFilter?: (f: JournalEntryFilter) => void
  hide?: readonly ('account' | 'counterparty' | 'project' | 'member' | 'batch' | 'source')[]
}) {
  const [filter, setFilter] = useState<JournalEntryFilter>(initial)
  return (
    <JournalFilterPanel
      filter={filter}
      options={options}
      hide={hide}
      resultCount={12}
      onChange={(next) => {
        setFilter(next)
        onFilter?.(next)
      }}
    />
  )
}

const splitCheckbox = () => screen.getByRole('checkbox', { name: '借方・貸方を分けて検索' })
const debitGroup = () => screen.getByRole('group', { name: '借方の条件' })
const creditGroup = () => screen.getByRole('group', { name: '貸方の条件' })
const pickIn = (group: HTMLElement, label: string, optionName: string) => {
  fireEvent.click(within(group).getByRole('button', { name: new RegExp(`^${label}:`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: optionName }))
}

describe('JournalFilterPanel: 借方・貸方を分けて検索', () => {
  it('はじめは「借方・貸方を分けて検索」のチェックが外れ、科目などの5項目が1組だけ並ぶ(科目などの条件の枠の中)', () => {
    render(<Harness />)

    expect(splitCheckbox()).not.toBeChecked()
    const axes = screen.getByRole('group', { name: '科目などの条件' })
    for (const label of ['科目', '取引先', 'プロジェクト', '世帯メンバー', '精算バッチ']) {
      expect(within(axes).getByRole('button', { name: new RegExp(`^${label}:`) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('group', { name: '借方の条件' })).toBeNull()
  })

  it('チェックを入れると、借方・貸方のまとまりに5項目ずつ分かれる', () => {
    render(<Harness />)
    fireEvent.click(splitCheckbox())

    for (const [group, side] of [
      [debitGroup(), '借方'],
      [creditGroup(), '貸方'],
    ] as const) {
      for (const label of ['科目', '取引先', 'プロジェクト', '世帯メンバー', '精算バッチ']) {
        expect(within(group).getByRole('button', { name: new RegExp(`^${side}の${label}:`) })).toBeInTheDocument()
      }
    }
  })

  it('借方の科目を選ぶと debit.accountIds、貸方の取引先を選ぶと credit.counterpartyIds で通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(splitCheckbox())
    pickIn(debitGroup(), '借方の科目', '雑費')
    expect(onFilter).toHaveBeenLastCalledWith({ debit: { accountIds: [9] } })

    pickIn(creditGroup(), '貸方の取引先', 'ローソン')
    expect(onFilter).toHaveBeenLastCalledWith({ debit: { accountIds: [9] }, credit: { counterpartyIds: [2] } })
  })

  it('世帯メンバー・精算バッチ・プロジェクトも、借方・貸方の側ごとに通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(splitCheckbox())
    pickIn(debitGroup(), '借方の世帯メンバー', '太郎')
    pickIn(creditGroup(), '貸方の精算バッチ', '10月分')
    pickIn(creditGroup(), '貸方のプロジェクト', '帰省')

    expect(onFilter).toHaveBeenLastCalledWith({
      debit: { householdMemberIds: [4] },
      credit: { settlementBatchIds: [6], projectIds: [3] },
    })
  })

  it('分けたときも、出どころは分かれない(借方・貸方のまとまりの外に1つだけ)', () => {
    render(<Harness />)
    fireEvent.click(splitCheckbox())

    expect(screen.getAllByRole('button', { name: /^出どころ:/ })).toHaveLength(1)
    expect(within(debitGroup()).queryByRole('button', { name: /^出どころ/ })).toBeNull()
  })

  it('チェックを入れると、競合する「まとめて」の条件は消え、摘要など仕訳単位の条件は残る', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ memo: '昼食', accountIds: [9], sourceTypes: ['manual'] }} onFilter={onFilter} />)
    fireEvent.click(splitCheckbox())

    expect(onFilter).toHaveBeenLastCalledWith({ memo: '昼食', sourceTypes: ['manual'] })
  })

  it('チェックを外すと、借方・貸方の条件が消える', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ memo: '昼食', debit: { accountIds: [9] } }} onFilter={onFilter} />)
    expect(splitCheckbox()).toBeChecked()
    fireEvent.click(splitCheckbox())

    expect(onFilter).toHaveBeenLastCalledWith({ memo: '昼食' })
    expect(screen.queryByRole('group', { name: '借方の条件' })).toBeNull()
  })

  it('借方・貸方の条件を持つ条件で開くと、はじめから分けた状態で、選択中の値がボタンに出る', () => {
    render(<Harness initial={{ credit: { accountIds: [1] } }} />)

    expect(splitCheckbox()).toBeChecked()
    expect(within(creditGroup()).getByRole('button', { name: /^貸方の科目:/ })).toHaveTextContent('外食')
  })

  it('hide に指定した項目は、借方・貸方のどちらからも隠す', () => {
    render(<Harness hide={['batch']} />)
    fireEvent.click(splitCheckbox())

    expect(within(debitGroup()).queryByRole('button', { name: /精算バッチ/ })).toBeNull()
    expect(within(creditGroup()).queryByRole('button', { name: /精算バッチ/ })).toBeNull()
  })

  it('借方・貸方の条件は、条件の数(「条件をクリア」の表示)に数えられ、クリアで消える', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ debit: { accountIds: [9] } }} onFilter={onFilter} />)
    fireEvent.click(screen.getByRole('button', { name: '条件をクリア' }))

    expect(onFilter).toHaveBeenLastCalledWith({})
  })
})

describe('JournalFilterPanel: 期間の日付/月の切替', () => {
  it('はじめは「日付で指定」で、日付入力を出す', () => {
    render(<Harness />)

    expect(screen.getByRole('checkbox', { name: '日付で指定' })).toBeChecked()
    expect(screen.getByLabelText('期間の開始')).toHaveAttribute('type', 'date')
  })

  it('チェックを外すと月の選択になり、月を選ぶと開始月1日〜終了月末日で通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '日付で指定' }))
    fireEvent.change(screen.getByRole('combobox', { name: '期間の開始' }), { target: { value: '2026-09' } })
    fireEvent.change(screen.getByRole('combobox', { name: '期間の終了' }), { target: { value: '2026-10' } })

    expect(onFilter).toHaveBeenLastCalledWith({ dateFrom: '2026-09-01', dateTo: '2026-10-31' })
  })

  it('日付を入れたまま月へ切り替えると、含まれる月に広がって通知する', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ dateFrom: '2026-10-15', dateTo: '2026-11-03' }} onFilter={onFilter} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '日付で指定' }))

    expect(onFilter).toHaveBeenLastCalledWith({ dateFrom: '2026-10-01', dateTo: '2026-11-30' })
  })
})

describe('JournalFilterPanel: 金額のスライダー', () => {
  it('スライダーをキーボードで動かすと、金額の範囲(数値)で通知し、数字入力にも入る', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.keyDown(screen.getByRole('slider', { name: '金額の下限のスライダー' }), { key: 'PageUp' })

    expect(onFilter).toHaveBeenLastCalledWith({ amountMin: 500 })
    expect(screen.getByLabelText('金額の下限')).toHaveValue('500')
  })

  it('数字入力は従来どおり使え、打った金額はスライダーの摘みに反映される', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('金額の上限'), { target: { value: '100000' } })

    expect(screen.getByRole('slider', { name: '金額の上限のスライダー' })).toHaveAttribute('aria-valuenow', '60')
  })
})

describe('JournalFilterPanel: 並びと「条件をクリア」', () => {
  it('出どころは、摘要の検索欄の隣(1行目)にあり、科目などの条件の枠の外にある', () => {
    render(<Harness />)
    const axes = screen.getByRole('group', { name: '科目などの条件' })

    expect(within(axes).queryByRole('button', { name: /^出どころ:/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^出どころ:/ })).toBeInTheDocument()
  })

  it('「条件をクリア」はアイコン(svg)つきのボタンで、押すとすべて消す', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ memo: 'a' }} onFilter={onFilter} />)
    const button = screen.getByRole('button', { name: '条件をクリア' })

    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    expect(onFilter).toHaveBeenLastCalledWith({})
  })
})
