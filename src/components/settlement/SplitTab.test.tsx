// @vitest-environment jsdom
/**
 * 割勘タブ(SplitTab、計画Issue #153)のコンポーネントテスト。承認済みモックアップの構成で、
 * 絞り込み・割勘する仕訳の表・分担(相手と割合)・割勘履歴が1画面に並ぶことを検証する。
 * 割勘できる仕訳だけが候補に出ること、選んだ仕訳の合計と相手の負担額が出ること、「割勘を記録」で
 * 仕訳が作られて画面が更新されること、相手を選ばないと記録できないこと、割勘履歴の表示と取り消し
 * (2回押し)を、インメモリの偽Repository(vi.fn)で検証する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { SplitTab } from './SplitTab'
import { deriveSplitSettle, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'

afterEach(cleanup)

function account(id: number, name: string, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    isActive: true,
    isSystemManaged,
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
    householdMemberId: null,
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
    },
    counterpartyRepository: { create: vi.fn(async () => ({ id: 20, name: '新しい人' })) },
  }
  const onChanged = vi.fn(async () => {})
  const onOpenEntry = vi.fn()
  render(
    <SplitTab
      data={data}
      derived={deriveSplitSettle(data)}
      repositories={repositories as unknown as SplitSettleRepositories}
      today="2026-10-31"
      onChanged={onChanged}
      onOpenEntry={onOpenEntry}
      {...extraProps}
    />,
  )
  return { repositories, onChanged, onOpenEntry }
}

const chooseOption = (triggerName: RegExp, optionName: string) => {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  fireEvent.click(within(screen.getByRole('dialog', { name: /分担相手/ })).getByRole('button', { name: optionName }))
}

describe('SplitTab', () => {
  it('割勘できる仕訳(借方に費用の行がある仕訳)だけを候補の表に出す', () => {
    setup()

    const table = screen.getByRole('region', { name: '割勘する仕訳' })
    expect(within(table).getByText('ランチ')).toBeInTheDocument()
    expect(within(table).queryByText('10月の給与')).not.toBeInTheDocument()
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

  it('割勘履歴に、これまでの割勘を相手・負担額・状態つきで表示する', () => {
    const split = entry(3, '2026-10-30', 'ランチの割勘', 'expense_splitting', [
      line(31, 3, 'debit', 1, 600, { householdMemberId: 2 }),
      line(32, 3, 'debit', 3, 600, { householdMemberId: 1, settlementBatchId: 7 }),
      line(33, 3, 'credit', 1, 600, { householdMemberId: 1 }),
      line(34, 3, 'credit', 4, 600, { householdMemberId: 2, settlementBatchId: 7 }),
    ])
    const data = makeData([split])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 1, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never

    setup(data)

    const history = screen.getByRole('region', { name: '割勘履歴' })
    const row = within(history).getByText('ランチ').closest('tr')!
    expect(within(row).getByText('妻')).toBeInTheDocument()
    expect(within(row).getByText(formatCurrency(600, 'JPY'))).toBeInTheDocument()
    expect(within(row).getByText('未精算')).toBeInTheDocument()
  })

  it('割勘の取り消しは2回押して確定し、仕訳を削除して画面を更新する', async () => {
    const split = entry(3, '2026-10-30', 'ランチの割勘', 'expense_splitting', [
      line(31, 3, 'debit', 1, 600, { householdMemberId: 2 }),
      line(32, 3, 'debit', 3, 600, { householdMemberId: 1, settlementBatchId: 7 }),
      line(33, 3, 'credit', 1, 600, { householdMemberId: 1 }),
      line(34, 3, 'credit', 4, 600, { householdMemberId: 2, settlementBatchId: 7 }),
    ])
    const data = makeData([split])
    data.memberships = [
      { id: 1, linkGroupId: 1, journalEntryId: 1, createdAt: '' },
      { id: 2, linkGroupId: 1, journalEntryId: 3, createdAt: '' },
    ] as never
    const { repositories, onChanged } = setup(data)

    fireEvent.click(screen.getByRole('button', { name: 'この割勘を取り消す' }))
    expect(repositories.journalEntryRepository.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '本当に取り消す' }))

    await waitFor(() => expect(repositories.journalEntryRepository.delete).toHaveBeenCalledWith(3))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
