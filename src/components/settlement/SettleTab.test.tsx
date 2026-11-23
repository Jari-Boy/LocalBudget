// @vitest-environment jsdom
/**
 * 精算タブ(SettleTab、計画Issue #153)のコンポーネントテスト。承認済みモックアップの構成で、
 * 精算バッチを先に選び、一覧に未収金と未払金の残高が別々に出ること、「未精算」「精算済み」(=クローズ済み、計画Issue #249)の
 * 切り替え、残高0での「クローズしますか?」の案内、残高があるままのクローズ(振替仕訳の自動作成)と再オープン、方向のカード(未収金を減らす/未払金を減らす)、候補の仕訳の選択と一致・不一致の操作
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

function account(
  id: number,
  name: string,
  category: Account['category'],
  isSystemManaged = false,
  systemRole: Account['systemRole'] = null,
): Account {
  return {
    id,
    category,
    name,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    systemRole,
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
  account(BANK, '普通預金', 'asset'),
  account(ADVANCE, '立替金', 'asset', true),
  account(PAYABLE, '未払金', 'liability', true),
  account(5, '給与', 'revenue'),
  account(GAIN, '雑収入', 'revenue', true, 'settlement_gain'),
  account(LOSS, '雑損失', 'expense', true, 'settlement_loss'),
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
    recurringDueDate: null,
    createdAt: '',
    updatedAt: '',
    lines,
  }
}

function batch(id: number, name: string, counterpartyId: number | null = null, isActive = true): SettlementBatch {
  return { id, name, type: 'expense_splitting', counterpartyId, isActive, createdAt: '', updatedAt: '' }
}

/** 10月分(未精算: 夫の立替金6000・妻の未払金6000)、9月分(残高0でクローズ済み=精算済み)、空のバッチ */
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
    batches: [batch(1, '10月分 割勘(妻)'), batch(4, '9月分 割勘(妻)', null, false), batch(5, '空のバッチ')],
    memberships: [],
    sourceLinks: [],
    closeEntries: [],
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
      delete: vi.fn(async () => {}),
      create: vi.fn(async () => ({ id: 900 }) as JournalEntry),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
    settlementBatchRepository: {
      create: vi.fn(),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => {}),
      deactivate: vi.fn(async () => ({})),
      activate: vi.fn(async () => ({})),
      recordCloseEntries: vi.fn(async () => {}),
      findCloseEntryIds: vi.fn(async (): Promise<number[]> => []),
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
  it('既定では未精算のバッチだけを、未収金と未払金の残高を別々の列で出す(明細が無い方は「-」)', () => {
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
    expect(within(selected()).getByText(/精算済みです\(クローズ済み\)。選択欄の候補には出ません。/)).toBeInTheDocument()
  })

  it('状態の絞り込みは「未精算」と「精算済み」の2つだけで、精算済みはクローズ済みのこと', () => {
    setup()

    const filters = within(screen.getByRole('group', { name: '精算状況で絞り込む' })).getAllByRole('button')
    expect(filters.map((b) => b.textContent)).toEqual(['未精算 2', '精算済み 1'])
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

  /** 10月分を、立替金の方向だけ6000が残る状態にしておき、立替金を精算し切ると全体が0になる */
  function dataSettledByTransfer() {
    const data = makeData()
    data.entries = data.entries.map((e) => (e.id === 100 ? { ...e, lines: e.lines.filter((l) => l.accountId !== PAYABLE) } : e))
    const reloaded = {
      ...data,
      entries: data.entries.map((e) =>
        e.id === 101 ? { ...e, lines: e.lines.map((l) => (l.id === 1012 ? { ...l, settlementBatchId: 1 } : l)) } : e,
      ),
    }
    return { data, reloaded }
  }

  /** 精算完了を押し、親が読み直したデータを渡し直して、残高が0になった状態にする */
  async function settleToZero() {
    const { data, reloaded } = dataSettledByTransfer()
    const view = setup(data)
    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込を選択' }))
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled())
    view.rerender(reloaded)
    return view
  }

  it('精算して残高が0になったバッチは、未精算のまま「クローズしますか?」のダイアログを出し、一覧にクローズ待ちの印を付ける', async () => {
    await settleToZero()

    expect(screen.getByRole('dialog', { name: 'クローズの確認' })).toHaveTextContent('「10月分 割勘(妻)」の残高が0になりました。')
    expect(screen.getByRole('button', { name: '未精算 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(batchList()).getByText('残高0 · クローズ待ち')).toBeInTheDocument()
  })

  it('ダイアログで「あとで」を選ぶと閉じ、パネルの案内とクローズ待ちの印は残る', async () => {
    await settleToZero()

    fireEvent.click(within(screen.getByRole('dialog', { name: 'クローズの確認' })).getByRole('button', { name: 'あとで' }))

    expect(screen.queryByRole('dialog', { name: 'クローズの確認' })).not.toBeInTheDocument()
    expect(within(selected()).getByText('残高が0になりました。クローズしますか?')).toBeInTheDocument()
    expect(within(batchList()).getByText('残高0 · クローズ待ち')).toBeInTheDocument()
  })

  it('ダイアログで「クローズする」を選ぶと、振替仕訳は作らずにクローズ済みにして、画面を更新する', async () => {
    const view = await settleToZero()

    fireEvent.click(within(screen.getByRole('dialog', { name: 'クローズの確認' })).getByRole('button', { name: 'クローズする' }))

    await waitFor(() => expect(view.repositories.settlementBatchRepository.deactivate).toHaveBeenCalledWith(1))
    expect(view.repositories.journalEntryRepository.create).not.toHaveBeenCalled()
    expect(view.repositories.settlementBatchRepository.recordCloseEntries).not.toHaveBeenCalled()
  })
})

describe('SettleTab: クローズと再オープン(計画Issue #249)', () => {
  const closeButton = () => within(selected()).getByRole('button', { name: 'このバッチをクローズ' })

  it('残高があるバッチは、クローズを押すと「残高があります」と振替仕訳の内容を確認に出し、やめれば何も書かない', () => {
    const view = setup()

    fireEvent.click(closeButton())

    expect(within(selected()).getByText(/残高があります/)).toBeInTheDocument()
    expect(within(selected()).getByText('借方 雑損失 / 貸方 立替金')).toBeInTheDocument()
    expect(within(selected()).getByText('借方 未払金 / 貸方 雑収入')).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: 'やめる' }))
    expect(within(selected()).queryByText(/残高があります/)).not.toBeInTheDocument()
    expect(view.repositories.settlementBatchRepository.deactivate).not.toHaveBeenCalled()
    expect(view.repositories.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('確認で「仕訳を作ってクローズする」を押すと、振替仕訳を作って記録し、クローズ済みにして画面を更新する', async () => {
    const view = setup()
    fireEvent.click(closeButton())

    fireEvent.click(within(selected()).getByRole('button', { name: '仕訳を作ってクローズする' }))

    await waitFor(() => expect(view.repositories.settlementBatchRepository.deactivate).toHaveBeenCalledWith(1))
    expect(view.repositories.journalEntryRepository.create).toHaveBeenCalledTimes(2)
    expect(view.repositories.settlementBatchRepository.recordCloseEntries).toHaveBeenCalledWith(1, [900, 900])
    expect(view.onChanged).toHaveBeenCalled()
  })

  it('クローズ済みのバッチは、再オープンで振替仕訳を削除して未精算に戻し、画面を更新する', async () => {
    const data = makeData()
    data.closeEntries = [{ batchId: 4, entryIds: [301, 302] }]
    const view = setup(data)
    view.repositories.settlementBatchRepository.findCloseEntryIds.mockResolvedValue([301, 302])
    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    expect(within(selected()).getByText(/クローズ時の自動仕訳\(2件\)を削除し/)).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '再オープンして自動仕訳を削除' }))

    await waitFor(() => expect(view.repositories.settlementBatchRepository.activate).toHaveBeenCalledWith(4))
    expect(view.repositories.journalEntryRepository.delete).toHaveBeenCalledWith(301)
    expect(view.repositories.journalEntryRepository.delete).toHaveBeenCalledWith(302)
    expect(view.onChanged).toHaveBeenCalled()
  })

  it('振替仕訳が無いクローズ済みのバッチは、「再オープンする」で有効に戻すだけ', async () => {
    const view = setup()
    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    fireEvent.click(within(selected()).getByRole('button', { name: '再オープンする' }))

    await waitFor(() => expect(view.repositories.settlementBatchRepository.activate).toHaveBeenCalledWith(4))
    expect(view.repositories.journalEntryRepository.delete).not.toHaveBeenCalled()
  })

  it('クローズ済みなのに残高があるバッチは、精算済みの一覧で先頭に並び、残高ありの印と警告を出す', () => {
    const data = makeData()
    // 空のバッチ(5)をクローズ済みにし、クローズ後に残高が動いた想定の仕訳を足す
    data.batches = [batch(1, '10月分 割勘(妻)'), batch(4, '9月分 割勘(妻)', null, false), batch(5, '空のバッチ', null, false)]
    data.entries = [
      ...data.entries,
      entry(300, '2026-11-10', 'クローズ後に直した仕訳', [
        line(3001, 300, 'debit', ADVANCE, 800, { householdMemberId: 1, settlementBatchId: 5 }),
        line(3002, 300, 'credit', BANK, 800),
      ]),
    ]
    setup(data)

    fireEvent.click(screen.getByRole('button', { name: '精算済み 2' }))

    const names = within(batchList()).getAllByRole('button', { name: /割勘|空の/ }).map((b) => b.textContent)
    expect(names).toEqual(['空のバッチ', '9月分 割勘(妻)'])
    expect(within(batchList()).getByText('残高あり')).toBeInTheDocument()
    expect(within(selected()).getByText(/精算済みですが、残高が残っています/)).toBeInTheDocument()
  })

  it('クローズ済みのバッチでは、精算する仕訳を探す節とバッチの削除の節を出さない', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    expect(within(selected()).queryByText('精算する仕訳を探す')).not.toBeInTheDocument()
    expect(within(selected()).queryByText('バッチの削除')).not.toBeInTheDocument()
  })
})

describe('SettleTab: 選んだバッチ', () => {
  it('未収金を減らす・未払金を減らすの2枚のカードに残高と内訳を出し、方向を切り替えられる', () => {
    setup()

    const cards = within(selected()).getByRole('group', { name: '精算の方向' })
    const advance = within(cards).getByRole('button', { name: /未収金を減らす/ })
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

describe('SettleTab: 精算バッチの紐づけの解除', () => {
  /** 10月分に、精算で紐づけた「妻から振込」(立替金の行1012)がある状態 */
  function dataWithLinkedEntry() {
    const data = makeData()
    data.entries = data.entries.map((e) =>
      e.id === 101 ? { ...e, lines: e.lines.map((l) => (l.id === 1012 ? { ...l, settlementBatchId: 1 } : l)) } : e,
    )
    return data
  }

  it('精算で紐づけた行は、2回押して、その行のタグだけを外して解除できる', async () => {
    const { updated, onChanged } = setup(dataWithLinkedEntry())

    fireEvent.click(within(selected()).getByRole('button', { name: '妻から振込の紐づけを解除' }))
    expect(within(selected()).getByText(/候補に戻り、バッチの残高が増えます/)).toBeInTheDocument()
    expect(updated).toHaveLength(0)
    fireEvent.click(within(selected()).getByRole('button', { name: '本当に解除する' }))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe(101)
    expect(updated[0].input.lines?.find((l) => l.id === 1012)?.settlementBatchId).toBeNull()
    expect(updated[0].input.lines?.find((l) => l.id === 1011)?.settlementBatchId).toBeNull()
  })

  it('割勘仕訳の行には、紐づけの解除を出さない(割勘の取り消しは割勘履歴・バッチの削除で行う)', () => {
    setup(dataWithLinkedEntry())

    expect(within(selected()).queryByRole('button', { name: /10月分の割勘の紐づけを解除/ })).not.toBeInTheDocument()
  })

  it('割勘以外の仕訳でも、債権債務を生む側の行(立替金の借方・未払金の貸方)には、紐づけの解除を出さない', () => {
    const data = makeData()
    // 手入力の後払いの仕訳のように、割勘仕訳ではなくても未払金の貸方にバッチが付いている状態
    data.entries = data.entries.map((e) => (e.id === 100 ? { ...e, sourceType: 'manual' as const } : e))
    setup(data)

    expect(within(selected()).getAllByRole('button', { name: /10月分の割勘/ }).length).toBeGreaterThan(0)
    expect(within(selected()).queryByRole('button', { name: /10月分の割勘の紐づけを解除/ })).not.toBeInTheDocument()
  })

  it('精算済みのバッチでも、紐づけを解除できる', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    expect(within(selected()).getAllByRole('button', { name: /9月分の精算の紐づけを解除/ }).length).toBeGreaterThan(0)
  })
})

describe('SettleTab: 精算バッチの削除', () => {
  const removeButton = () => within(selected()).getByRole('button', { name: 'このバッチを削除' })

  it('割勘仕訳だけで成り立つ未精算のバッチは、2回押して、割勘仕訳ごと削除できる', async () => {
    const data = makeData()
    data.entries = data.entries.filter((e) => e.id !== 101 && e.id !== 102 && e.id !== 103)
    const { repositories, onChanged } = setup(data)

    fireEvent.click(removeButton())
    expect(within(selected()).getByText(/割勘仕訳1件とこのバッチを削除します/)).toBeInTheDocument()
    expect(repositories.settlementBatchRepository.delete).not.toHaveBeenCalled()
    fireEvent.click(within(selected()).getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(repositories.settlementBatchRepository.delete).toHaveBeenCalledWith(1))
    expect(repositories.journalEntryRepository.delete).toHaveBeenCalledWith(100)
    expect(repositories.journalEntryRepository.delete).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('割勘仕訳を消したあとにバッチを消す順で、途中で失敗したらバッチは消さない', async () => {
    const data = makeData()
    data.entries = data.entries.filter((e) => e.id !== 101 && e.id !== 102 && e.id !== 103)
    const { repositories } = setup(data)
    repositories.journalEntryRepository.delete.mockRejectedValueOnce(new Error('失敗'))

    fireEvent.click(removeButton())
    fireEvent.click(within(selected()).getByRole('button', { name: '本当に削除する' }))

    expect(await within(selected()).findByRole('alert')).toHaveTextContent('削除できませんでした')
    expect(repositories.settlementBatchRepository.delete).not.toHaveBeenCalled()
  })

  it('明細の無い空のバッチも、仕訳を消さずに削除できる', async () => {
    const { repositories } = setup()

    fireEvent.click(within(batchList()).getByRole('button', { name: '空のバッチ' }))
    fireEvent.click(removeButton())
    expect(within(selected()).getByText(/割勘仕訳0件とこのバッチを削除します/)).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '本当に削除する' }))

    await waitFor(() => expect(repositories.settlementBatchRepository.delete).toHaveBeenCalledWith(5))
    expect(repositories.journalEntryRepository.delete).not.toHaveBeenCalled()
  })

  it('割勘仕訳以外の仕訳(精算で紐づけた仕訳など)があるバッチは、削除ボタンを押せず、理由を出す', () => {
    const data = makeData()
    data.entries = data.entries.map((e) =>
      e.id === 101 ? { ...e, lines: e.lines.map((l) => (l.id === 1012 ? { ...l, settlementBatchId: 1 } : l)) } : e,
    )
    setup(data)

    expect(removeButton()).toBeDisabled()
    expect(within(selected()).getByText(/割勘仕訳以外の仕訳.*紐づいているため、削除できません/)).toBeInTheDocument()
  })

  it('精算済みのバッチには削除ボタンを出さない', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: '精算済み 1' }))

    expect(within(selected()).queryByRole('button', { name: 'このバッチを削除' })).not.toBeInTheDocument()
  })
})

describe('SettleTab: 候補の仕訳で精算する', () => {
  it('選んだ方向(未収金を減らす=未収金の貸方)の未割当の明細だけを候補にする', () => {
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

  it('差額の計上先を改名していても、役割で見つけて、その名前の科目に計上する', async () => {
    const renamed = makeData().accounts.map((a) =>
      a.id === GAIN ? { ...a, name: 'その他の収入' } : a,
    )
    const { repositories } = setup({ ...makeData(), accounts: renamed })

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込(端数あり)を選択' }))
    expect(within(selected()).getByText(/その他の収入に計上して/)).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(repositories.journalEntryRepository.create).toHaveBeenCalledTimes(1))
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ lines: JournalLine[] }][])[0][0]
    expect(created.lines.some((l) => l.accountId === GAIN && l.amount === 150)).toBe(true)
  })

  it('同じ名前の通常科目があっても、役割を持つ科目に計上する(名前では引かない)', async () => {
    const decoy = account(99, '雑収入', 'revenue')
    const data = makeData()
    const renamed = data.accounts.map((a) => (a.id === GAIN ? { ...a, name: 'その他の収入' } : a))
    const { repositories } = setup({ ...data, accounts: [decoy, ...renamed] })

    fireEvent.click(screen.getByRole('checkbox', { name: '妻から振込(端数あり)を選択' }))
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))

    await waitFor(() => expect(repositories.journalEntryRepository.create).toHaveBeenCalledTimes(1))
    const created = (repositories.journalEntryRepository.create.mock.calls as unknown as [{ lines: JournalLine[] }][])[0][0]
    expect(created.lines.some((l) => l.accountId === GAIN)).toBe(true)
    expect(created.lines.some((l) => l.accountId === 99)).toBe(false)
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

/**
 * 候補の仕訳のチェックの範囲選択・トグル選択・Esc での全解除、Ctrl/Cmd を押したまま行のどこかを押したときのチェックの操作
 * (計画Issue #235 D)。候補の並び順には依存しない(表の1行目・2行目として扱う)。
 */
describe('SettleTab: 候補の仕訳の範囲選択・Ctrl選択・Esc(計画Issue #235 D)', () => {
  const candidateBoxes = () => within(within(selected()).getByRole('table', { name: '精算の候補' })).getAllByRole('checkbox') as HTMLInputElement[]
  const checkedFlags = () => candidateBoxes().map((box) => box.checked)

  it('候補は2件以上あり、最初はどれも選ばれていない', () => {
    setup()
    expect(candidateBoxes().length).toBeGreaterThanOrEqual(2)
    expect(checkedFlags().every((checked) => !checked)).toBe(true)
  })

  it('Shift+クリックで、直前に選んだ候補から押した候補までが選ばれる', () => {
    setup()
    const last = candidateBoxes().length - 1
    fireEvent.click(candidateBoxes()[0])
    fireEvent.click(candidateBoxes()[last], { shiftKey: true })
    expect(checkedFlags().every((checked) => checked)).toBe(true)
  })

  it('Ctrl+候補の行の文字部分を押すと、その候補のチェックが切り替わる(Cmd でも同じ)', () => {
    setup()
    const row = candidateBoxes()[0].closest('tr') as HTMLElement
    fireEvent.click(row.querySelectorAll('td')[2], { ctrlKey: true })
    expect(candidateBoxes()[0].checked).toBe(true)
    fireEvent.click(row.querySelectorAll('td')[2], { metaKey: true })
    expect(candidateBoxes()[0].checked).toBe(false)
  })

  it('チェックが1件でもあるときは、Ctrl を押さなくても、別の候補の行の文字部分を押すとチェックが切り替わる', () => {
    setup()
    fireEvent.click(candidateBoxes()[0])
    const second = candidateBoxes()[1].closest('tr') as HTMLElement
    fireEvent.click(second.querySelectorAll('td')[2])
    expect(candidateBoxes()[1].checked).toBe(true)
    fireEvent.click(second.querySelectorAll('td')[2])
    expect(candidateBoxes()[1].checked).toBe(false)
  })

  it('チェックにフォーカスして Shift+↓ を押すと、次の候補までが選ばれ、フォーカスが次のチェックへ移る', () => {
    setup()
    candidateBoxes()[0].focus()
    fireEvent.keyDown(candidateBoxes()[0], { key: 'ArrowDown', shiftKey: true })
    expect(candidateBoxes()[0].checked).toBe(true)
    expect(candidateBoxes()[1].checked).toBe(true)
    expect(candidateBoxes()[1]).toHaveFocus()
  })

  it('選んだあとに Esc を押すと、選択がすべて外れ、選択合計は 0 に戻る', () => {
    setup()
    fireEvent.click(candidateBoxes()[0])
    expect(within(selected()).getByText('選択合計').parentElement).not.toHaveTextContent(yen(0))
    fireEvent.keyDown(candidateBoxes()[0], { key: 'Escape' })
    expect(checkedFlags().every((checked) => !checked)).toBe(true)
    expect(within(selected()).getByText('選択合計').parentElement).toHaveTextContent(yen(0))
  })
})

describe('SettleTab: 残高が負の精算(相手へ返す向きの割勘、計画Issue #271)', () => {
  /** 貸方の行(返金)を割った割勘: 夫の立替金は貸方に300、妻の未払金は借方に300(残高はどちらもマイナス300) */
  function negativeData(): SplitSettleData {
    const data = makeData()
    data.batches = [batch(1, '返品の割勘(妻)')]
    data.entries = [
      entry(
        100,
        '2026-10-30',
        '返品の割勘',
        [
          line(1001, 100, 'debit', 1, 300, { householdMemberId: 1 }),
          line(1002, 100, 'credit', 1, 300, { householdMemberId: 2 }),
          line(1003, 100, 'credit', ADVANCE, 300, { householdMemberId: 1, settlementBatchId: 1 }),
          line(1004, 100, 'debit', PAYABLE, 300, { householdMemberId: 2, settlementBatchId: 1 }),
        ],
        'expense_splitting',
      ),
      // 夫が妻へ返す: 立替金を借方に持つ未割当の仕訳
      entry(110, '2026-11-03', '妻へ返金', [
        line(1101, 110, 'debit', ADVANCE, 300, { householdMemberId: 1 }),
        line(1102, 110, 'credit', BANK, 300),
      ]),
    ]
    return data
  }

  it('残高をマイナスで出し、相手へ返す側の精算であることを案内する', () => {
    setup(negativeData())

    expect(within(selected()).getByText((text) => text.includes('残高がマイナス') && text.includes('相手へ返す側の精算'))).toBeInTheDocument()
  })

  it('残高がマイナスのときは、立替金を借方に持つ仕訳を候補にし、残高の大きさと一致すれば精算完了にできる', async () => {
    const { updated } = setup(negativeData())

    fireEvent.click(screen.getByRole('checkbox', { name: '妻へ返金を選択' }))

    expect(within(selected()).getByText('✓ 残高と一致しています')).toBeInTheDocument()
    fireEvent.click(within(selected()).getByRole('button', { name: '精算完了' }))
    await waitFor(() => expect(updated.map((u) => u.id)).toContain(110))
  })
})
