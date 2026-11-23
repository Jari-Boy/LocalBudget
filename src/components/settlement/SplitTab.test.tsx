// @vitest-environment jsdom
/**
 * 割勘タブ(SplitTab、計画Issue #153)のコンポーネントテスト。承認済みモックアップの構成で、
 * 絞り込み・割勘する仕訳の表・分担(相手と割合)が1画面に並ぶことを検証する。
 * 割勘できる仕訳だけが候補に出ること、選んだ仕訳の合計と相手の負担額が出ること、「割勘を記録」で
 * 仕訳が作られて画面が更新されること、相手を選ばないと記録できないことを、インメモリの偽Repository(vi.fn)で検証する。
 * 割勘履歴は履歴タブ(SplitHistoryTab、計画Issue #268)に移したので、そのテストは SplitHistoryTab.test.tsx にある。
 * 候補は150件ずつ「さらにN件表示」で出し、チェック済みの行が150件の外にあるときは選択行まで広げる(計画Issue #268)。
 */
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { chooseBatchFrom } from '../master/batchSelectTestHelpers'
import { SplitTab } from './SplitTab'
import { deriveSplitSettle, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: id,
    createdAt: '',
    updatedAt: '',
  }
}

const accounts = [
  account(1, '食費', 'expense'),
  account(2, '普通預金', 'asset'),
  account(3, '立替金', 'asset', true),
  account(4, '未払金', 'liability', true),
  account(5, '給与', 'revenue'),
]

function line(
  id: number,
  entryId: number,
  side: 'debit' | 'credit',
  accountId: number,
  amount: number,
  overrides: Partial<JournalLine> = {},
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
    ...overrides,
  }
}

function entry(id: number, date: string, memo: string, sourceType: JournalEntry['sourceType'], lines: JournalLine[]): JournalEntry {
  return {
    id,
    entryDate: date,
    memo,
    comment: null,
    currency: 'JPY',
    sourceType,
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

function makeData(extraEntries: JournalEntry[] = []): SplitSettleData {
  return {
    entries: [
      entry(1, '2026-10-05', 'ランチ', 'manual', [line(11, 1, 'debit', 1, 1200), line(12, 1, 'credit', 2, 1200)]),
      entry(2, '2026-10-03', '10月の給与', 'manual', [line(21, 2, 'debit', 2, 300000), line(22, 2, 'credit', 5, 300000)]),
      ...extraEntries,
    ],
    accounts,
    accountGroups: [],
    counterparties: [{ id: 9, name: '友人A', isActive: true } as never],
    counterpartyGroups: [],
    projects: [],
    projectGroups: [],
    members: [
      { id: 1, name: '夫' },
      { id: 2, name: '妻' },
    ] as never,
    batches: [],
    memberships: [],
  }
}

function setup(data: SplitSettleData = makeData(), extraProps: { initialCheckedEntryIds?: readonly number[] } = {}) {
  const repositories = {
    journalEntryRepository: {
      create: vi.fn(async () => ({ id: 500 }) as JournalEntry),
      delete: vi.fn(async () => {}),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
    settlementBatchRepository: {
      create: vi.fn(async (input: { name: string }) => ({ id: 77, name: input.name })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => {}),
    },
    counterpartyRepository: { create: vi.fn(async () => ({ id: 20, name: '新しい人' })) },
  }
  const onChanged = vi.fn(async () => {})
  render(
    <SplitTab
      data={data}
      derived={deriveSplitSettle(data)}
      repositories={repositories as unknown as SplitSettleRepositories}
      today="2026-10-31"
      onChanged={onChanged}
      filter={{}}
      onFilterChange={() => {}}
      filterOpen={false}
      {...extraProps}
    />,
  )
  return { repositories, onChanged }
}

const chooseOption = (triggerName: RegExp, optionName: string) => {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  fireEvent.click(within(screen.getByRole('dialog', { name: /分担相手/ })).getByRole('button', { name: optionName }))
}

const splitEntry = () =>
  entry(3, '2026-10-30', 'ランチの割勘', 'expense_splitting', [
    line(31, 3, 'debit', 1, 600, { householdMemberId: 2 }),
    line(32, 3, 'debit', 3, 600, { householdMemberId: 1, settlementBatchId: 7 }),
    line(33, 3, 'credit', 1, 600, { householdMemberId: 1 }),
    line(34, 3, 'credit', 4, 600, { householdMemberId: 2, settlementBatchId: 7 }),
  ])

describe('SplitTab', () => {
  it('これまでの割勘(履歴)は割勘タブには出さない(履歴タブに移した、計画Issue #268)', () => {
    const data = makeData([splitEntry()])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 1, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never
    setup(data)

    expect(screen.queryByRole('region', { name: '割勘履歴' })).not.toBeInTheDocument()
    expect(screen.queryByText('過去の割勘')).not.toBeInTheDocument()
    expect(screen.queryByText('ランチの割勘')).not.toBeInTheDocument()
  })

  it('割勘できる仕訳(借方に費用の行がある仕訳)だけを候補の表に出す', () => {
    setup()

    const table = screen.getByRole('region', { name: '割勘する仕訳' })
    expect(within(table).getByText('ランチ')).toBeInTheDocument()
    expect(within(table).queryByText('10月の給与')).not.toBeInTheDocument()
  })

  it('候補の摘要を押すと、仕訳画面へ移動せず、その仕訳の詳細をダイアログで表示し、選択状態は変えない', () => {
    setup()

    fireEvent.click(within(screen.getByRole('region', { name: '割勘する仕訳' })).getByRole('button', { name: 'ランチ' }))

    const dialog = screen.getByRole('dialog', { name: '仕訳の詳細' })
    expect(dialog).toHaveTextContent('2026-10-05')
    expect(within(dialog).getByRole('region', { name: '借方' })).toHaveTextContent('食費')
    expect(screen.getByRole('checkbox', { name: 'ランチを選択' })).not.toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: '仕訳の詳細' })).not.toBeInTheDocument()
  })

  it('仕訳を選ぶと、選んだ合計と、設定した割合での相手の負担額を表示する', () => {
    setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    chooseOption(/^分担相手/, '妻')

    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1200, 'JPY'))
    expect(within(panel).getByText('相手の負担額').nextElementSibling).toHaveTextContent(formatCurrency(600, 'JPY'))
  })

  it('「割勘を記録」で割勘仕訳を作り、元の仕訳と同じ関連仕訳グループへ合流して画面を更新する', async () => {
    const { repositories, onChanged } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    chooseOption(/^分担相手/, '妻')
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(repositories.settlementBatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'ランチの割勘' }),
    )
    expect(repositories.journalEntryRepository.create).toHaveBeenCalledTimes(1)
    expect(repositories.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1], [500])
    expect(screen.getByText('割勘を記録しました')).toBeInTheDocument()
  })

  it('摘要を入力して割勘すると、その摘要が割勘仕訳の摘要と、新しく作る精算バッチの名前になる', async () => {
    const { repositories } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    chooseOption(/^分担相手/, '妻')
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '10月の外食まとめ' } })
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() =>
      expect(repositories.settlementBatchRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: '10月の外食まとめ' }),
      ),
    )
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ memo: string }][])[0][0]
    expect(created.memo).toBe('10月の外食まとめ')
  })

  it('摘要が空のときは、既定の摘要(元の摘要+の割勘)を使い、入力欄の例としても見せる', () => {
    setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))

    expect(screen.getByLabelText('摘要')).toHaveAttribute('placeholder', 'ランチの割勘')
  })

  it('精算バッチは、既定で「新しいバッチを作成」が選ばれ、既存のバッチも候補に出て、選び直して戻せる', () => {
    const data = makeData()
    data.batches = [{ id: 7, name: '9月の精算', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]
    setup(data)

    const batchButton = () => screen.getByRole('button', { name: /^精算バッチ: (新しいバッチを作成|9月の精算)$/ })
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 新しいバッチを作成')
    fireEvent.click(batchButton())
    const dialog = within(screen.getByRole('dialog', { name: '精算バッチ' }))
    expect(dialog.getByRole('button', { name: '新しいバッチを作成' })).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '9月の精算' }))
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 9月の精算')

    chooseBatchFrom(batchButton(), '新しいバッチを作成')
    expect(batchButton()).toHaveAccessibleName('精算バッチ: 新しいバッチを作成')
  })

  it('既存の精算バッチを選んだときも、入力した摘要は割勘仕訳の摘要になり、バッチは作らない', async () => {
    const data = makeData()
    data.batches = [{ id: 7, name: '9月の精算', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]
    const { repositories } = setup(data)

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    chooseOption(/^分担相手/, '妻')
    fireEvent.change(screen.getByLabelText('摘要'), { target: { value: '追加分' } })
    // 画面の上の絞り込みにも「精算バッチ」の欄があるので、既定で「新しいバッチを作成」が選ばれているほうのボタンを渡す
    chooseBatchFrom(screen.getByRole('button', { name: '精算バッチ: 新しいバッチを作成' }), '9月の精算')
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    await waitFor(() => expect(repositories.journalEntryRepository.create).toHaveBeenCalled())
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ memo: string }][])[0][0]
    expect(created.memo).toBe('追加分')
    expect(repositories.settlementBatchRepository.create).not.toHaveBeenCalled()
  })

  it('仕訳画面の「この仕訳を割勘」から来たときは、その仕訳を最初から選んだ状態にする', () => {
    setup(makeData(), { initialCheckedEntryIds: [1] })

    expect(screen.getByRole('checkbox', { name: 'ランチを選択' })).toBeChecked()
    const panel = screen.getByRole('region', { name: '分担' })
    expect(within(panel).getByText('選択した合計').nextElementSibling).toHaveTextContent(formatCurrency(1200, 'JPY'))
  })

  it('仕訳を選んでいないと「割勘を記録」は押せない', () => {
    setup()

    expect(screen.getByRole('button', { name: '割勘を記録' })).toBeDisabled()
  })

  it('分担相手を選ばずに記録しようとすると、何も作らずエラーを表示する', async () => {
    const { repositories } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'ランチを選択' }))
    fireEvent.click(screen.getByRole('button', { name: '割勘を記録' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('分担相手を選んでください')
    expect(repositories.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('分担相手を追加でき、2人目以降は外せる(1人目は外せない)', () => {
    setup()

    expect(screen.getByRole('button', { name: /を分担相手から外す/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '+ 分担相手を追加' }))

    const removeButtons = screen.getAllByRole('button', { name: /を分担相手から外す/ })
    expect(removeButtons).toHaveLength(2)
    fireEvent.click(removeButtons[1])
    expect(screen.getAllByRole('button', { name: /を分担相手から外す/ })).toHaveLength(1)
  })

  it('金額指定の按分に切り替えると、割合の代わりに相手ごとの金額を入力できる', () => {
    setup()

    fireEvent.change(screen.getByLabelText('按分の方法'), { target: { value: 'amount' } })

    expect(screen.queryByLabelText(/の負担割合/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/の負担額を入力/)).toBeInTheDocument()
  })
})

/**
 * 割勘する仕訳のチェックの範囲選択・トグル選択・Esc での全解除、Ctrl/Cmd を押したまま行のどこかを押したときのチェックの操作
 * (計画Issue #235 D)。表の並びは日付の新しい順(ランチ 10/5 → コーヒー 10/4 → 映画 10/2)。
 */
describe('SplitTab: 割勘する仕訳の範囲選択・Ctrl選択・Esc(計画Issue #235 D)', () => {
  const extra = () => [
    entry(5, '2026-10-04', 'コーヒー', 'manual', [line(51, 5, 'debit', 1, 400), line(52, 5, 'credit', 2, 400)]),
    entry(6, '2026-10-02', '映画', 'manual', [line(61, 6, 'debit', 1, 1800), line(62, 6, 'credit', 2, 1800)]),
  ]
  const box = (memo: string) => screen.getByRole('checkbox', { name: `${memo}を選択` }) as HTMLInputElement
  const flags = () => ['ランチ', 'コーヒー', '映画'].map((memo) => box(memo).checked)

  it('Shift+クリックで、直前に選んだ仕訳から押した仕訳までが選ばれる', () => {
    setup(makeData(extra()))
    fireEvent.click(box('ランチ'))
    fireEvent.click(box('映画'), { shiftKey: true })
    expect(flags()).toEqual([true, true, true])
  })

  it('Ctrl+クリックで離れた仕訳を選べ、Cmd+クリックでその仕訳だけ外せる', () => {
    setup(makeData(extra()))
    fireEvent.click(box('ランチ'))
    fireEvent.click(box('映画'), { ctrlKey: true })
    expect(flags()).toEqual([true, false, true])
    fireEvent.click(box('ランチ'), { metaKey: true })
    expect(flags()).toEqual([false, false, true])
  })

  it('Ctrl+行の文字部分を押すと、その仕訳のチェックが切り替わる', () => {
    setup(makeData(extra()))
    const row = box('コーヒー').closest('tr') as HTMLElement
    fireEvent.click(row.querySelectorAll('td')[1], { ctrlKey: true })
    expect(flags()).toEqual([false, true, false])
  })

  it('Ctrl+摘要のボタンを押すと、詳細のダイアログは開かず、その仕訳のチェックが切り替わる', () => {
    setup(makeData(extra()))
    fireEvent.click(screen.getByRole('button', { name: 'コーヒー' }), { ctrlKey: true })
    expect(flags()).toEqual([false, true, false])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('チェックが1件でもあるときは、Ctrl を押さなくても、摘要のボタンを押すと詳細は開かず、その仕訳のチェックが切り替わる', () => {
    setup(makeData(extra()))
    fireEvent.click(box('ランチ'))
    fireEvent.click(screen.getByRole('button', { name: 'コーヒー' }))
    expect(flags()).toEqual([true, true, false])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Ctrl を押さずに摘要のボタンを押すと、従来どおり詳細のダイアログが開き、チェックは変わらない', () => {
    setup(makeData(extra()))
    fireEvent.click(screen.getByRole('button', { name: 'コーヒー' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(flags()).toEqual([false, false, false])
  })

  it('チェックにフォーカスして Shift+↓ を押すと、次の仕訳までが選ばれ、フォーカスが次のチェックへ移る', () => {
    setup(makeData(extra()))
    box('ランチ').focus()
    fireEvent.keyDown(box('ランチ'), { key: 'ArrowDown', shiftKey: true })
    expect(flags()).toEqual([true, true, false])
    expect(box('コーヒー')).toHaveFocus()
  })

  it('選んだあとに Esc を押すと、選択がすべて外れる', () => {
    setup(makeData(extra()))
    fireEvent.click(box('ランチ'))
    fireEvent.click(box('映画'), { shiftKey: true })
    fireEvent.keyDown(box('映画'), { key: 'Escape' })
    expect(flags()).toEqual([false, false, false])
  })
})

/**
 * 割勘する仕訳の候補の150件ずつの表示(計画Issue #268)。候補は日付の新しい順で、
 * 先頭が「ランチ」(10/5)、続いて「支出{N-1}」…「支出0」(9/1、同じ日付なら id の大きい順)。
 */
describe('SplitTab: 割勘する仕訳の150件ずつの表示(計画Issue #268)', () => {
  /** 候補が total 件ある状態(ランチ+支出0〜支出{total-2}) */
  function manyCandidates(total: number): SplitSettleData {
    const extras = Array.from({ length: total - 1 }, (_, i) =>
      entry(100 + i, '2026-09-01', `支出${i}`, 'manual', [
        line(1000 + i * 2, 100 + i, 'debit', 1, 100),
        line(1001 + i * 2, 100 + i, 'credit', 2, 100),
      ]),
    )
    return makeData(extras)
  }
  const checkboxCount = () => screen.getAllByRole('checkbox').length

  it('150件以下のときは全件を出し、「さらに表示」は出さない', () => {
    setup(manyCandidates(150))

    expect(checkboxCount()).toBe(150)
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('150件を超えるときは、新しい150件だけを出し、「150 / 160件を表示中」と「さらに10件表示」を出す', () => {
    setup(manyCandidates(160))

    expect(checkboxCount()).toBe(150)
    expect(screen.getByText('ランチ')).toBeInTheDocument()
    expect(screen.queryByText('支出0')).not.toBeInTheDocument()
    expect(screen.getByText('150 / 160件を表示中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに10件表示' })).toBeInTheDocument()
  })

  it('「さらに10件表示」を押すと残りも出て、ボタンは消える', () => {
    setup(manyCandidates(160))

    fireEvent.click(screen.getByRole('button', { name: 'さらに10件表示' }))

    expect(checkboxCount()).toBe(160)
    expect(screen.getByText('支出0')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('チェック済みの仕訳が150件の外にあるときは、その仕訳が見える件数まで表示を広げる', () => {
    // 支出0(id 100)は新しい順で160番目。最初から選んだ状態にすると、150件の外なので、その行を含む300件まで(全体の160件)広がる
    setup(manyCandidates(160), { initialCheckedEntryIds: [100] })

    expect(checkboxCount()).toBe(160)
    expect(screen.getByRole('checkbox', { name: '支出0を選択' })).toBeChecked()
    expect(screen.queryByRole('button', { name: /^さらに/ })).not.toBeInTheDocument()
  })

  it('チェック済みの仕訳が150件の中にあるときは、表示を広げない', () => {
    setup(manyCandidates(160), { initialCheckedEntryIds: [149] })

    expect(checkboxCount()).toBe(150)
    expect(screen.getByRole('button', { name: 'さらに10件表示' })).toBeInTheDocument()
  })

  it('絞り込み条件を変えると、増やした表示件数は先頭の150件に戻る', () => {
    const data = manyCandidates(160)
    function Harness() {
      const [filter, setFilter] = useState<JournalEntryFilter>({})
      return (
        <SplitTab
          data={data}
          derived={deriveSplitSettle(data)}
          repositories={{} as unknown as SplitSettleRepositories}
          today="2026-10-31"
          onChanged={async () => {}}
          filter={filter}
          onFilterChange={setFilter}
          filterOpen
        />
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'さらに10件表示' }))
    expect(checkboxCount()).toBe(160)

    // 「支出」を含む摘要は159件(ランチを除く)。表示件数が戻らなければ159件すべてが出てしまう
    fireEvent.change(screen.getByRole('searchbox', { name: '摘要で検索' }), { target: { value: '支出' } })

    expect(checkboxCount()).toBe(150)
    expect(screen.getByRole('button', { name: 'さらに9件表示' })).toBeInTheDocument()
  })
})
