// @vitest-environment jsdom
/**
 * 精算タブ(SettleTab、計画Issue #153)のコンポーネントテスト。承認済みモックアップの構成で、
 * 精算バッチを先に選び、一覧に立替金と未払金の残高が別々に出ること、「未精算」「精算済み」「すべて」の
 * 切り替え、方向のカード(立替金を減らす/未払金を減らす)、候補の仕訳の選択と一致・不一致の操作
 * (精算完了・未精算として残す・差額の計上)、候補の有無によらない精算の仕訳の起票、バッチ名と
 * 世帯外の相手の編集を、インメモリの偽Repository(vi.fn)で検証する。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { SettleTab } from './SettleTab'
import { deriveSplitSettle, type SplitSettleData, type SplitSettleRepositories } from './splitSettleData'

afterEach(cleanup)

const BANK = 2
const ADVANCE = 3
const PAYABLE = 4
const GAIN = 6
const LOSS = 7

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
  account(BANK, '普通預金', 'asset'),
  account(ADVANCE, '立替金', 'asset', true),
  account(PAYABLE, '未払金', 'liability', true),
  account(5, '給与', 'revenue'),
  account(GAIN, '雑収入', 'revenue'),
  account(LOSS, '雑損失', 'expense'),
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

function entry(id: number, date: string, memo: string, lines: JournalLine[], sourceType: JournalEntry['sourceType'] = 'manual'): JournalEntry {
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

function batch(id: number, name: string, counterpartyId: number | null = null): SettlementBatch {
  return { id, name, type: 'expense_splitting', counterpartyId, createdAt: '', updatedAt: '' }
}

/** 10月分(未精算: 夫の立替金6000・妻の未払金6000)、9月分(精算済み)、空のバッチ */
function makeData(): SplitSettleData {
  return {
    entries: [
      entry(
        100,
        '2026-10-30',
        '10月分の割勘',
        [
          line(1001, 100, 'debit', 1, 6000, { householdMemberId: 2 }),
          line(1002, 100, 'debit', ADVANCE, 6000, { householdMemberId: 1, settlementBatchId: 1 }),
          line(1003, 100, 'credit', 1, 6000, { householdMemberId: 1 }),
          line(1004, 100, 'credit', PAYABLE, 6000, { householdMemberId: 2, settlementBatchId: 1 }),
        ],
        'expense_splitting',
      ),
      entry(101, '2026-11-02', '妻から振込', [
        line(1011, 101, 'debit', BANK, 6000),
        line(1012, 101, 'credit', ADVANCE, 6000, { householdMemberId: 1 }),
      ]),
      entry(102, '2026-11-03', '妻から振込(端数あり)', [
        line(1021, 102, 'debit', BANK, 6150),
        line(1022, 102, 'credit', ADVANCE, 6150, { householdMemberId: 1 }),
      ]),
      entry(103, '2026-11-04', '未払金の支払い候補', [
        line(1031, 103, 'debit', PAYABLE, 6000, { householdMemberId: 2 }),
        line(1032, 103, 'credit', BANK, 6000),
      ]),
      entry(
        200,
        '2026-09-30',
        '9月分の割勘',
        [
          line(2001, 200, 'debit', ADVANCE, 3000, { householdMemberId: 1, settlementBatchId: 4 }),
          line(2002, 200, 'credit', PAYABLE, 3000, { householdMemberId: 2, settlementBatchId: 4 }),
        ],
        'expense_splitting',
      ),
      entry(201, '2026-10-05', '9月分の精算', [
        line(2011, 201, 'debit', BANK, 3000),
        line(2012, 201, 'credit', ADVANCE, 3000, { householdMemberId: 1, settlementBatchId: 4 }),
        line(2013, 201, 'debit', PAYABLE, 3000, { householdMemberId: 2, settlementBatchId: 4 }),
        line(2014, 201, 'credit', BANK, 3000),
      ]),
    ],
    accounts,
    accountGroups: [],
    counterparties: [{ id: 9, name: '友人A', isActive: true, counterpartyGroupId: null, sortOrder: 1 } as never],
    counterpartyGroups: [],
    projects: [],
    projectGroups: [],
    members: [
      { id: 1, name: '夫' },
      { id: 2, name: '妻' },
    ] as never,
    batches: [batch(1, '10月分 割勘(妻)'), batch(4, '9月分 割勘(妻)'), batch(5, '空のバッチ')],
    memberships: [],
  }
}

function setup(data: SplitSettleData = makeData()) {
  const updated: { id: number; input: UpdateJournalEntryInput }[] = []
  const repositories = {
    journalEntryRepository: {
      update: vi.fn(async (id: number, input: UpdateJournalEntryInput) => {
        updated.push({ id, input })
        return { id } as JournalEntry
      }),
      create: vi.fn(async () => ({ id: 900 }) as JournalEntry),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
    settlementBatchRepository: {
      create: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    counterpartyRepository: { create: vi.fn(async () => ({ id: 20, name: '新しい人' })) },
  }
  const onChanged = vi.fn(async () => {})
  const element = (next: SplitSettleData) => (
    <SettleTab
      data={next}
      derived={deriveSplitSettle(next)}
      repositories={repositories as unknown as SplitSettleRepositories}
      today="2026-11-09"
      onChanged={onChanged}
    />
  )
  const view = render(element(data))
  /** 親が書き込み後にデータを読み直した状態を再現する */
  const rerender = (next: SplitSettleData) => view.rerender(element(next))
  return { repositories, onChanged, updated, rerender }
}

const batchList = () => screen.getByRole('region', { name: '精算バッチ一覧' })
const selected = () => screen.getByRole('region', { name: '選択中の精算バッチ' })
const yen = (n: number) => formatCurrency(n, 'JPY')

describe('SettleTab: 精算バッチの一覧', () => {
  it('既定では未精算のバッチだけを、立替金と未払金の残高を別々の列で出す(明細が無い方は「-」)', () => {
    setup()

    const row = within(batchList()).getByRole('button', { name: '10月分 割勘(妻)' }).closest('tr')!
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent(yen(6000))
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent(yen(6000))
    expect(within(batchList()).queryByRole('button', { name: '9月分 割勘(妻)' })).not.toBeInTheDocument()
    const emptyRow = within(batchList()).getByRole('button', { name: '空のバッチ' }).closest('tr')!
    expect(within(emptyRow).getAllByRole('cell')[1]).toHaveTextContent('-')
  })

  it('「精算済み」で切り替えると精算済みのバッチを出し、件数をボタンに表示する', () => {
    setup()

    expect(screen.getByRole('button', { name: '未精算 2' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    expect(within(batchList()).getByRole('button', { name: '9月分 割勘(妻)' })).toBeInTheDocument()
    expect(within(batchList()).queryByRole('button', { name: '10月分 割勘(妻)' })).not.toBeInTheDocument()
    expect(within(selected()).getByText('精算済みです。立替金と未払金の残高はどちらも0です。')).toBeInTheDocument()
  })

  it('精算済みのバッチでは、紐づく仕訳を閲覧でき、仕訳をクリックすると仕訳画面へ移動せずダイアログで開く', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))
    fireEvent.click(within(selected()).getAllByRole('button', { name: /9月分の精算/ })[0])

    const dialog = screen.getByRole('dialog', { name: '仕訳の詳細' })
    expect(dialog).toHaveTextContent('2026-10-05')
    fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: '仕訳の詳細' })).not.toBeInTheDocument()
  })

  it('精算して残高が0になったバッチは、「精算済み」の一覧に移り、そのまま精算済みとして表示する', async () => {
    const data = makeData()
    // 10月分は立替金の方向だけ6000が残る状態にしておき、立替金を精算し切ると全体が0になる
    data.entries = data.entries.map((e) =>
      e.id === 100
        ? { ...e, lines: e.lines.filter((l) => l.accountId !== PAYABLE) }
        : e,
    )
    const view = setup(data)

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込を選択' }))
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled())

    // 親が読み直したデータ(妻から振込に10月分のタグが付いた状態)を渡し直す
    const reloaded = {
      ...data,
      entries: data.entries.map((e) =>
        e.id === 101
          ? { ...e, lines: e.lines.map((l) => (l.id === 1012 ? { ...l, settlementBatchId: 1 } : l)) }
          : e,
      ),
    }
    view.rerender(reloaded)

    expect(screen.getByRole('button', { name: '精算済み 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(batchList()).getByRole('button', { name: '10月分 割勘(妻)' })).toBeInTheDocument()
    expect(within(selected()).getByText('精算済みです。立替金と未払金の残高はどちらも0です。')).toBeInTheDocument()
  })
})

describe('SettleTab: 選んだバッチ', () => {
  it('立替金を減らす・未払金を減らすの2枚のカードに残高と内訳を出し、方向を切り替えられる', () => {
    setup()

    const cards = within(selected()).getByRole('group', { name: '精算の方向' })
    const advance = within(cards).getByRole('button', { name: /立替金を減らす/ })
    const payable = within(cards).getByRole('button', { name: /未払金を減らす/ })
    expect(advance).toHaveAttribute('aria-pressed', 'true')
    expect(advance).toHaveTextContent(yen(6000))
    expect(advance).toHaveTextContent('夫 ' + yen(6000))
    expect(payable).toHaveTextContent(yen(6000))
    expect(payable).toHaveTextContent('妻 ' + yen(6000))

    fireEvent.click(payable)
    expect(payable).toHaveAttribute('aria-pressed', 'true')
    expect(advance).toHaveAttribute('aria-pressed', 'false')
  })

  it('明細が1行も無いバッチには、その旨を出す', () => {
    setup()

    fireEvent.click(within(batchList()).getByRole('button', { name: '空のバッチ' }))

    expect(within(selected()).getByText('このバッチが付いた明細はまだありません。')).toBeInTheDocument()
  })

  it('バッチ名を変えて確定すると、バッチ名を更新して画面を更新する', async () => {
    const { repositories, onChanged } = setup()

    const input = within(selected()).getByLabelText('バッチ名')
    fireEvent.change(input, { target: { value: '10月分 生活費' } })
    fireEvent.blur(input)

    await waitFor(() => expect(repositories.settlementBatchRepository.update).toHaveBeenCalledWith(1, { name: '10月分 生活費' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('世帯外の相手を選ぶと、バッチの取引先を更新する', async () => {
    const { repositories } = setup()

    fireEvent.click(within(selected()).getByRole('button', { name: /^世帯外の相手/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '世帯外の相手' })).getByRole('button', { name: '友人A' }))

    await waitFor(() =>
      expect(repositories.settlementBatchRepository.update).toHaveBeenCalledWith(1, { counterpartyId: 9 }),
    )
  })
})

describe('SettleTab: 候補の仕訳で精算する', () => {
  it('選んだ方向(立替金を減らす=立替金の貸方)の未割当の明細だけを候補にする', () => {
    setup()

    const table = within(selected()).getByRole('table', { name: '精算の候補' })
    expect(within(table).getByText('妻から振込')).toBeInTheDocument()
    expect(within(table).queryByText('未払金の支払い候補')).not.toBeInTheDocument()

    fireEvent.click(within(selected()).getByRole('button', { name: /未払金を減らす/ }))
    const payableTable = within(selected()).getByRole('table', { name: '精算の候補' })
    expect(within(payableTable).getByText('未払金の支払い候補')).toBeInTheDocument()
    expect(within(payableTable).queryByText('妻から振込')).not.toBeInTheDocument()
  })

  it('残高と一致する仕訳を選ぶと「精算完了」だけが出て、押すと選んだ仕訳にバッチのタグを付ける', async () => {
    const { updated, onChanged } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込を選択' }))

    expect(within(selected()).getByText('選択合計').parentElement).toHaveTextContent(yen(6000))
    expect(within(selected()).queryByRole('button', { name: '未精算として残す' })).not.toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(updated[0].id).toBe(101)
    expect(updated[0].input.lines?.find((l) => l.id === 1012)?.settlementBatchId).toBe(1)
  })

  it('残高と合わない仕訳を選ぶと差額を示し、「未精算として残す」ではタグを付けるだけで差額の仕訳は作らない', async () => {
    const { repositories, updated } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込(端数あり)を選択' }))

    expect(within(selected()).getByText(/^差額 /)).toHaveTextContent(`+${yen(150)}`)
    fireEvent.click(within(selected()).getByRole('button', { name: '未精算として残す' }))

    await waitFor(() => expect(updated).toHaveLength(1))
    expect(repositories.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('残高と合わない仕訳で「精算完了」を押すと、差額を雑収入に計上する仕訳を作る', async () => {
    const { repositories } = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込(端数あり)を選択' }))
    expect(within(selected()).getByText(/雑収入に計上して/)).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(repositories.journalEntryRepository.create).toHaveBeenCalledTimes(1))
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ lines: JournalLine[] }][])[0][0]
    expect(created.lines.some((l) => l.accountId === GAIN && l.amount === 150)).toBe(true)
  })

  it('候補があっても、「+ 精算の仕訳を起票」から仕訳を起票してバッチに紐づけられる', async () => {
    const { repositories, onChanged } = setup()

    fireEvent.click(within(selected()).getByRole('button', { name: '+ 精算の仕訳を起票' }))
    fireEvent.click(within(selected()).getByRole('button', { name: /^相手科目/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '相手科目' })).getByRole('button', { name: '普通預金' }))
    fireEvent.change(within(selected()).getByLabelText('金額'), { target: { value: '2500' } })
    fireEvent.click(within(selected()).getByRole('button', { name: '起票してバッチに紐付け' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ lines: JournalLine[] }][])[0][0]
    expect(created.lines).toContainEqual(expect.objectContaining({ accountId: ADVANCE, side: 'credit', amount: 2500, settlementBatchId: 1 }))
    expect(repositories.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalled()
  })

  it('世帯外の相手のバッチでも、精算の仕訳の立替金の行に、バッチの行と同じ世帯メンバーを付ける', async () => {
    const data = makeData()
    data.batches = data.batches.map((b) => (b.id === 1 ? { ...b, counterpartyId: 9 } : b))
    const { repositories, onChanged } = setup(data)

    fireEvent.click(within(selected()).getByRole('button', { name: '+ 精算の仕訳を起票' }))
    fireEvent.click(within(selected()).getByRole('button', { name: /^相手科目/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '相手科目' })).getByRole('button', { name: '普通預金' }))
    fireEvent.click(within(selected()).getByRole('button', { name: '起票してバッチに紐付け' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ lines: JournalLine[] }][])[0][0]
    expect(created.lines).toContainEqual(
      expect.objectContaining({ accountId: ADVANCE, settlementBatchId: 1, householdMemberId: 1 }),
    )
  })

  it('条件に合う候補が無いときは、その旨を出す', () => {
    setup()

    fireEvent.click(within(selected()).getByRole('button', { name: '絞り込み' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '摘要で検索' }), { target: { value: '存在しない摘要' } })

    expect(
      within(selected()).getByText('条件に合う未割当の仕訳はありません。条件を変えるか、仕訳を起票してください。'),
    ).toBeInTheDocument()
  })
})
