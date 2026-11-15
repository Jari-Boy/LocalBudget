// @vitest-environment jsdom
/**
 * 仕訳の絞り込みパネル(JournalFilterPanel)と、ポップアップ版(JournalFilterPopup)の
 * コンポーネントテスト(計画Issue #150)。文字検索・期間・金額・科目・取引先・プロジェクト・
 * 世帯メンバー・精算バッチ・出どころを最初からすべて並べ(「条件を追加」方式にしない)、
 * 入力ごとにJournalEntryFilterで通知することを検証する。ポップアップ版は同じパネルを
 * ボタンの下に開き、有効な条件の数をボタンに出す。
 計画Issue #203で、全6軸(科目・取引先・プロジェクト・世帯メンバー・精算バッチ・出どころ)を
 * 複数選択にした。選んでも各欄が閉じないこと、項目とグループ・「未割当」の併用、「指定なし」での
 * 軸ごとの解除、ボタンの「ほか○件」表示、ポップアップ版の中でツリーを操作しても絞り込み全体が
 * 閉じないことも検証する。
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
          children: [
            { kind: 'item', value: '1', name: '外食', isActive: true },
            { kind: 'item', value: '11', name: '食料品', isActive: true },
          ],
        },
        { kind: 'item', value: '9', name: '雑費', isActive: true },
      ],
    },
  ],
  counterpartyCategories: flat([
    { value: '2', name: 'ローソン' },
    { value: '7', name: 'ファミマ' },
  ]),
  projectCategories: flat([{ value: '3', name: '帰省' }]),
  members: [
    { value: '4', name: '太郎' },
    { value: '5', name: '花子' },
  ],
  batches: [
    { value: '6', name: '10月分' },
    { value: '8', name: '11月分' },
  ],
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

/** 複数選択の欄を開き、続けて複数の項目を選ぶ(選んでも閉じないので、開くのは最初の1回だけ) */
const pickMany = (label: string, ...optionNames: string[]) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }))
  const dialog = screen.getByRole('dialog', { name: label })
  for (const name of optionNames) fireEvent.click(within(dialog).getByRole('button', { name }))
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

    // 複数選択なので、続けて同じ欄でグループも選べる(併用、軸の中はOR)
    fireEvent.click(screen.getByRole('button', { name: '食費をすべて選ぶ' }))
    expect(onFilter).toHaveBeenLastCalledWith({ accountIds: [1], accountGroupIds: [10] })
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

describe('JournalFilterPanel: 項目を隠す(計画Issue #153)', () => {
  it('hide に指定した項目は出さず、ほかの項目は出し続ける', () => {
    render(<JournalFilterPanel filter={{}} onChange={() => {}} options={options} hide={['batch']} />)

    expect(screen.queryByRole('button', { name: /^精算バッチ/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^科目/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^世帯メンバー/ })).toBeInTheDocument()
  })

  it('hide を指定しなければ、これまでどおりすべての項目を出す', () => {
    render(<JournalFilterPanel filter={{}} onChange={() => {}} options={options} />)

    expect(screen.getByRole('button', { name: /^精算バッチ/ })).toBeInTheDocument()
  })
})

describe('JournalFilterPanel: 複数選択(計画Issue #203)', () => {
  it('科目・取引先・プロジェクトは、項目とグループを併用して複数選べる', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    pickMany('科目', '食費', '外食', '雑費')
    fireEvent.click(screen.getByRole('button', { name: '食費をすべて選ぶ' }))
    pickMany('取引先', 'ローソン', 'ファミマ')
    pickMany('プロジェクト', '帰省')
    expect(onFilter).toHaveBeenLastCalledWith({
      accountIds: [1, 9],
      accountGroupIds: [10],
      counterpartyIds: [2, 7],
      projectIds: [3],
    })
  })

  it('世帯メンバー・精算バッチ・出どころも複数選べ、精算バッチは「未割当」と併用できる', () => {
    const onFilter = vi.fn()
    render(<Harness onFilter={onFilter} />)
    pickMany('世帯メンバー', '太郎', '花子')
    pickMany('精算バッチ', '未割当', '10月分')
    pickMany('出どころ', '手入力', '外部明細')
    expect(onFilter).toHaveBeenLastCalledWith({
      householdMemberIds: [4, 5],
      settlementBatchIds: [null, 6],
      sourceTypes: ['manual', 'external_import'],
    })
  })

  it('複数選択すると、ボタンに「先頭 ほか○件」を出す。1件のときはその項目名', () => {
    render(<Harness initial={{ householdMemberIds: [4, 5], accountIds: [9] }} />)
    expect(screen.getByRole('button', { name: /^世帯メンバー:/ })).toHaveTextContent('太郎 ほか1件')
    expect(screen.getByRole('button', { name: /^科目:/ })).toHaveTextContent('雑費')
  })

  it('選んでも欄は閉じず、選択中の項目にチェックの印(aria-pressed)が付く', () => {
    render(<Harness />)
    pickMany('出どころ', '手入力')
    const dialog = screen.getByRole('dialog', { name: '出どころ' })
    expect(within(dialog).getByRole('button', { name: '手入力' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByRole('button', { name: '外部明細' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('「指定なし」を押すと、その軸の選択だけがすべて消える', () => {
    const onFilter = vi.fn()
    render(<Harness initial={{ householdMemberIds: [4, 5], sourceTypes: ['manual'] }} onFilter={onFilter} />)
    pickMany('世帯メンバー', '指定なし')
    expect(onFilter).toHaveBeenLastCalledWith({ sourceTypes: ['manual'] })
  })

  it('選択中の値がグループだけでも、項目だけでも、条件の数は軸ごとに1件', () => {
    render(<JournalFilterPopup filter={{ accountIds: [1, 9], accountGroupIds: [10], sourceTypes: ['manual'] }} options={options} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '絞り込み(2)' })).toBeInTheDocument()
  })
})

describe('JournalFilterPopup: 中のツリー選択の操作(計画Issue #203)', () => {
  function PopupHarness() {
    const [filter, setFilter] = useState<JournalEntryFilter>({})
    return <JournalFilterPopup filter={filter} options={options} onChange={setFilter} />
  }

  it('ポップアップの中でツリー選択の項目を押しても、絞り込み全体のポップアップは閉じない', () => {
    render(<PopupHarness />)
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: /^出どころ:/ }))
    const tree = screen.getByRole('dialog', { name: '出どころ' })
    // ツリーの一覧はdocument.bodyへ描画されるため、DOM上は絞り込みの外にある
    fireEvent.pointerDown(within(tree).getByRole('button', { name: '手入力' }))
    fireEvent.click(within(tree).getByRole('button', { name: '手入力' }))
    expect(screen.getByRole('search', { name: '仕訳の絞り込み' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^出どころ:/ })).toHaveTextContent('手入力')
  })

  it('ツリー選択の外側(絞り込みの外)を押すと、絞り込み全体が閉じる', () => {
    render(
      <div>
        <button type="button">外側</button>
        <PopupHarness />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    fireEvent.click(screen.getByRole('button', { name: /^出どころ:/ }))
    fireEvent.pointerDown(screen.getByRole('button', { name: '外側' }))
    expect(screen.queryByRole('search')).toBeNull()
  })
})
