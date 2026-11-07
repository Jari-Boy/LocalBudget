// @vitest-environment jsdom
/**
 * 仕訳の絞り込みパネル(JournalFilterPanel)と、ポップアップ版(JournalFilterPopup)の
 * コンポーネントテスト(計画Issue #150)。文字検索・期間・金額・科目・取引先・プロジェクト・
 * 世帯メンバー・精算バッチ・出どころを最初からすべて並べ(「条件を追加」方式にしない)、
 * 入力ごとにJournalEntryFilterで通知することを検証する。ポップアップ版は同じパネルを
 * ボタンの下に開き、有効な条件の数をボタンに出す。
 * 外部依存なし(絞り込みの実行自体はドメイン層の責務のため、ここでは条件の生成だけを見る)。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { JournalFilterPanel, type JournalFilterOptions } from './JournalFilterPanel'
import { JournalFilterPopup } from './JournalFilterPopup'

afterEach(cleanup)

const flat = (items: { value: string; name: string }[]) => [
  {
    key: 'flat',
    name: '',
    nodes: items.map((i) => ({ kind: 'item' as const, ...i, isActive: true })),
  },
]

const options: JournalFilterOptions = {
  accountCategories: [
    {
      key: 'expense',
      name: '費用',
      nodes: [
        {
          kind: 'group',
          id: '10',
          name: '食費',
          children: [{ kind: 'item', value: '1', name: '外食', isActive: true }],
        },
      ],
    },
  ],
  counterpartyCategories: flat([{ value: '2', name: 'ローソン' }]),
  projectCategories: flat([{ value: '3', name: '帰省' }]),
  members: [
    { value: '4', name: '太郎' },
    { value: '5', name: '花子' },
  ],
  batches: [{ value: '6', name: '10月分' }],
  sourceTypes: [
    { value: 'manual', name: '手入力' },
    { value: 'external_import', name: '外部明細' },
  ],
}

function Harness({ initial = {}, onFilter }: { initial?: JournalEntryFilter; onFilter?: (f: JournalEntryFilter) => void }) {
  const [filter, setFilter] = useState<JournalEntryFilter>(initial)
  return (
    <JournalFilterPanel
      filter={filter}
      options={options}
      resultCount={12}
      onChange={(next) => {
        setFilter(next)
        onFilter?.(next)
      }}
    />
  )
}

const pick = (label: string, optionName: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }))
  fireEvent.click(within(screen.getByRole('dialog', { name: label })).getByRole('button', { name: optionName }))
}

describe('JournalFilterPanel', () => {
  it('9つの条件欄を最初からすべて表示する(条件を追加する操作は不要)', () => {
    render(<Harness />)
    const panel = screen.getByRole('search', { name: '仕訳の絞り込み' })
    expect(within(panel).getByRole('searchbox', { name: '摘要で検索' })).toBeInTheDocument()
    expect(within(panel).getByLabelText('期間の開始')).toBeInTheDocument()
    expect(within(panel).getByLabelText('期間の終了')).toBeInTheDocument()
    expect(within(panel).getByLabelText('金額の下限')).toBeInTheDocument()
    expect(within(panel).getByLabelText('金額の上限')).toBeInTheDocument()
    for (const label of ['科目', '取引先', 'プロジェクト', '世帯メンバー', '精算バッチ', '出どころ']) {
      expect(within(panel).getByRole('button', { name: new RegExp(`^${label}:`) })).toBeInTheDocument()
    }
  })

  it('摘要・期間・金額の入力をJournalEntryFilterとして通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '摘要で検索' }), { target: { value: '昼食' } })
    expect(onFilter).toHaveBeenLastCalledWith({ memo: '昼食' })
    fireEvent.change(screen.getByLabelText('期間の開始'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('期間の終了'), { target: { value: '2026-10-31' } })
    fireEvent.change(screen.getByLabelText('金額の下限'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('金額の上限'), { target: { value: '5000' } })
    expect(onFilter).toHaveBeenLastCalledWith({
      memo: '昼食',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      amountMin: 1000,
      amountMax: 5000,
    })
  })

  it('科目は項目で選べば科目ID、グループで選べば科目グループIDで通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    fireEvent.click(screen.getByRole('button', { name: /^科目:/ }))
    const dialog = screen.getByRole('dialog', { name: '科目' })
    fireEvent.click(within(dialog).getByRole('button', { name: '食費' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '外食' }))
    expect(onFilter).toHaveBeenLastCalledWith({ accountIds: [1] })

    fireEvent.click(screen.getByRole('button', { name: /^科目:/ }))
    fireEvent.click(screen.getByRole('button', { name: '食費をすべて選ぶ' }))
    expect(onFilter).toHaveBeenLastCalledWith({ accountGroupIds: [10] })
  })

  it('取引先・プロジェクト・世帯メンバー・精算バッチ・出どころを選んで通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    pick('取引先', 'ローソン')
    pick('プロジェクト', '帰省')
    pick('世帯メンバー', '花子')
    pick('精算バッチ', '10月分')
    pick('出どころ', '外部明細')
    expect(onFilter).toHaveBeenLastCalledWith({
      counterpartyIds: [2],
      projectIds: [3],
      householdMemberIds: [5],
      settlementBatchIds: [6],
      sourceTypes: ['external_import'],
    })
  })

  it('精算バッチには「未割当」の選択肢があり、nullで通知する', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    pick('精算バッチ', '未割当')
    expect(onFilter).toHaveBeenLastCalledWith({ settlementBatchIds: [null] })
  })

  it('条件があるときだけ「条件をクリア」を表示し、押すとすべて消す', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    expect(screen.queryByRole('button', { name: '条件をクリア' })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: '摘要で検索' }), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: '条件をクリア' }))
    expect(onFilter).toHaveBeenLastCalledWith({})
    expect(screen.queryByRole('button', { name: '条件をクリア' })).toBeNull()
  })

  it('該当件数を表示する', () => {
    render(<Harness />)
    expect(screen.getByRole('status')).toHaveTextContent('12件')
  })

  it('選択中の値(グループ指定を含む)が各欄のボタンに表示される', () => {
    render(<Harness initial={{ accountGroupIds: [10], sourceTypes: ['manual'] }} />)
    expect(screen.getByRole('button', { name: /^科目:/ })).toHaveTextContent('食費(配下すべて)')
    expect(screen.getByRole('button', { name: /^出どころ:/ })).toHaveTextContent('手入力')
  })
})

describe('JournalFilterPopup', () => {
  function PopupHarness({ initial = {} }: { initial?: JournalEntryFilter }) {
    const [filter, setFilter] = useState<JournalEntryFilter>(initial)
    return <JournalFilterPopup filter={filter} options={options} onChange={setFilter} />
  }

  it('ボタンには有効な条件の数を出し、押すとパネルがポップアップで開く', () => {
    render(<PopupHarness initial={{ memo: 'a', accountIds: [1] }} />)
    const button = screen.getByRole('button', { name: '絞り込み(2)' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('search')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('search', { name: '仕訳の絞り込み' })).toBeInTheDocument()
  })

  it('条件がないときはボタンに件数を出さない', () => {
    render(<PopupHarness />)
    expect(screen.getByRole('button', { name: '絞り込み' })).toBeInTheDocument()
  })

  it('Escで閉じてボタンへフォーカスが戻り、外側のクリックでも閉じる', () => {
    render(
      <div>
        <button type="button">外側</button>
        <PopupHarness />
      </div>,
    )
    const button = screen.getByRole('button', { name: '絞り込み' })
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByRole('search'), { key: 'Escape' })
    expect(screen.queryByRole('search')).toBeNull()
    expect(button).toHaveFocus()

    fireEvent.click(button)
    fireEvent.pointerDown(screen.getByRole('button', { name: '外側' }))
    expect(screen.queryByRole('search')).toBeNull()
  })
})
