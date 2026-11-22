// @vitest-environment jsdom
/**
 * 仕訳画面(JournalScreen、計画Issue #152)のコンポーネントテスト。
 * 絞り込み・結果一覧・詳細が画面遷移なしで切り替わること、保存で精算バッチのタグとコメントが
 * 保持されること、貸借が合わないと保存されないこと、精算バッチを付けられない科目で拒否されたときの
 * 表示(計画Issue #167)、確定済みの仕訳の削除(2回押し・影響の表示・
 * 次の行の選択)、割勘できない理由の表示、下書き(保存・確定・削除)、定期仕訳の提案
 * (金額修正して確定・見送り・古い提案が残っていると処理できない)、関連仕訳の表示を検証する。計画Issue #164で追加した、
 * 承認待ちの定期仕訳タブの摘要・コメントの編集と保存、土日の調整後の日付と金額の初期値の表示、一覧に科目を出さないこと、
 * 複数の提案のまとめて確定(チェックの連動・すべて選択・起票者の一括指定・confirmManyの呼び出し)も検証する。
 * 未保存の警告を出さない設定(計画Issue #190)のときは、仕訳の切り替えも画面外への移動もリロードも確認を出さないことも検証する。
 * 仕訳一覧の分割表示(計画Issue #253)として、1ページ分(JOURNAL_LIST_PAGE_SIZE)ずつの描画と「さらに表示」、絞り込み後の全体件数の表示、
 * 絞り込み条件の変更での先頭への復帰、選択中の仕訳が表示範囲の外にならないこと、明細行単位でも同じ分割になること、
 * 見出しのチェックが表示中の行だけを選ぶこと、2ページ目の行での行クリック・範囲選択、表示から外れた行のチェックが落ちること、
 * 表示中の最後の仕訳を削除したときの次の選択も検証する。
 * 絞り込み欄の開閉(計画Issue #266)として、初期状態が閉じていること、アイコンのボタンでの開閉、閉じても条件が保たれ件数バッジが出ること、
 * ボタンがタブと同じ行にあることも検証する(既存テストは memoSearch で開いてから検索欄を使う)。
 * 外部依存はインメモリの偽Repository(vi.fn)で置き換える。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { JournalEntryDraft } from '../../domain/journal/JournalEntryDraft'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { UnsavedChangesGuardProvider, useUnsavedChangesGuard } from '../common/unsaved-changes/unsavedChangesGuard'
import { saveUnsavedWarningEnabled } from '../common/unsaved-changes/unsavedWarningSetting'
import { chooseMember, expectMember, expectMembers, findMemberButton } from '../master/memberSelectTestHelpers'
import { findBatchButton } from '../master/batchSelectTestHelpers'
import { JournalScreen, type JournalScreenProps } from './JournalScreen'
import { JOURNAL_LIST_PAGE_SIZE } from './journalListPaging'
import type { RecurringTransactionRuleLine } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import type { JournalTemplateGroup } from '../../domain/journal-template-group/JournalTemplateGroup'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** サイドナビなど、画面の外からの移動を模す。未保存の変更があればガードが引き受けて続行関数を預かる */
const leaveSpy = vi.fn()
function LeaveProbe() {
  const guard = useUnsavedChangesGuard()
  return (
    <button type="button" onClick={() => !guard.intercept(() => leaveSpy()) && leaveSpy()}>
      テスト用: 画面を離れる
    </button>
  )
}

function account(id: number, name: string, category: Account['category'], isReconcilable: boolean | null = null): Account {
  return {
    id,
    category,
    name,
    isReconcilable,
    hasExternalStatement: isReconcilable,
    isActive: true,
    isSystemManaged: false,
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
  account(2, '普通預金', 'asset', true),
  { ...account(3, '立替金', 'asset', false), isSystemManaged: true },
  account(4, '家賃', 'expense'),
  { ...account(5, '残高調整', 'expense'), isSystemManaged: true },
]

function line(id: number, entryId: number, side: 'debit' | 'credit', accountId: number, amount: number, batch: number | null = null): JournalLine {
  return {
    id,
    journalEntryId: entryId,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: batch,
    side,
    amount,
    createdAt: '',
  }
}

function entry(id: number, date: string, memo: string, sourceType: JournalEntry['sourceType'], lines: JournalLine[], comment: string | null = null): JournalEntry {
  return {
    id,
    entryDate: date,
    memo,
    comment,
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

function makeEntries(): JournalEntry[] {
  return [
    entry(1, '2026-10-05', 'ランチ', 'manual', [line(11, 1, 'debit', 1, 1200), line(12, 1, 'credit', 2, 1200)]),
    entry(2, '2026-10-03', '家賃', 'external_import', [line(21, 2, 'debit', 4, 80000), line(22, 2, 'credit', 2, 80000)]),
    entry(3, '2026-10-01', '旅行の立替', 'manual', [line(31, 3, 'debit', 3, 5000, 7), line(32, 3, 'credit', 2, 5000)], 'あとで精算'),
    entry(4, '2026-09-30', '割勘の夕食', 'expense_splitting', [line(41, 4, 'debit', 3, 2000, 7), line(42, 4, 'credit', 1, 2000)]),
  ]
}

function makeDrafts(): JournalEntryDraft[] {
  return [
    {
      id: 100,
      purpose: 'manual_entry',
      entryDate: '2026-10-10',
      memo: '書きかけ',
      comment: null,
      currency: null,
      householdMemberId: 1,
      createdAt: '2026-10-10T00:00:00',
      updatedAt: '2026-10-10T00:00:00',
      lines: [
        { id: 1, journalEntryDraftId: 100, accountId: 1, projectId: null, householdMemberId: null, counterpartyId: null, side: 'debit', amount: 900, createdAt: '' },
        { id: 2, journalEntryDraftId: 100, accountId: null, projectId: null, householdMemberId: null, counterpartyId: null, side: 'credit', amount: null, createdAt: '' },
      ],
    },
  ]
}

const groupOf = (id: number, name: string) => ({ id, name, parentGroupId: null, sortOrder: 0, isActive: true, createdAt: '', updatedAt: '' })

/** 貸借が一致している下書き(借方: 科目1、貸方: 科目2、同額) */
function balancedDraft(id: number, memo: string): JournalEntryDraft {
  const base = makeDrafts()[0]
  return {
    ...base,
    id,
    memo,
    lines: [
      { ...base.lines[0], id: id * 10, journalEntryDraftId: id, amount: 1200 },
      { ...base.lines[1], id: id * 10 + 1, journalEntryDraftId: id, accountId: 2, amount: 1200 },
    ],
  }
}

function setup(
  overrides: Partial<{
    entries: JournalEntry[]
    drafts: JournalEntryDraft[]
    initialFilter: JournalEntryFilter
    rulesPanel: ReactNode
    /** 見出しとタブの間に出す案内(はじめのチェックリスト、計画Issue #177) */
    banner: ReactNode
    /** 渡すと「テンプレートから起票」が使える(計画Issue #201) */
    templates: JournalTemplate[]
    templateGroups: JournalTemplateGroup[]
    templatesPanel: ReactNode
    onOpenAccountReconciliation: (accountId: number) => void
    /** 渡すと「明細から起票」が使える。押すと明細取込画面へ移る(計画Issue #214・#231) */
    onStartStatementImport: () => void
    /** 取引先・プロジェクトの追加ダイアログのグループ欄に出す、すでにあるグループ(計画Issue #207) */
    counterpartyGroups: ReturnType<typeof groupOf>[]
    projectGroups: ReturnType<typeof groupOf>[]
  }> = {},
) {
  let entries = overrides.entries ?? makeEntries()
  let drafts = overrides.drafts ?? makeDrafts()
  const proposals = [
    // 2026-11-01は日曜日。翌平日調整で、仕訳の日付(entryDate)は11/2になる
    { ruleId: 1, dueDate: '2026-11-01', entryDate: '2026-11-02', defaultAmount: 5200, defaultLines: ruleLines(4, 2, 5200) },
    { ruleId: 1, dueDate: '2026-10-01', entryDate: '2026-10-01', defaultAmount: 5000, defaultLines: ruleLines(4, 2, 5000) },
    { ruleId: 2, dueDate: '2026-10-15', entryDate: '2026-10-15', defaultAmount: 3000, defaultLines: ruleLines(4, 2, 3000) },
  ]
  const journalEntryRepository = {
    findAll: vi.fn(async () => entries),
    create: vi.fn(async (input: { entryDate: string; lines: unknown[] }) => {
      const created = entry(99, input.entryDate, 'new', 'manual', [])
      entries = [created, ...entries]
      return created
    }),
    update: vi.fn(async (id: number) => entries.find((e) => e.id === id)!),
    delete: vi.fn(async (id: number) => {
      entries = entries.filter((e) => e.id !== id)
    }),
  }
  const journalEntryDraftRepository = {
    findAll: vi.fn(async () => drafts),
    create: vi.fn(async () => drafts[0]),
    update: vi.fn(async () => drafts[0]),
    delete: vi.fn(async (id: number) => {
      drafts = drafts.filter((d) => d.id !== id)
    }),
    confirm: vi.fn(async (id: number) => {
      drafts = drafts.filter((d) => d.id !== id)
      return entries[0]
    }),
  }
  const recurringTransactionProposalApi = {
    listPending: vi.fn(async () => proposals),
    confirm: vi.fn(async () => entries[0]),
    confirmMany: vi.fn(async (input: { items: readonly unknown[] }) => input.items.map(() => entries[0])),
    skip: vi.fn(async () => undefined),
  }
  const props = {
    journalEntryRepository,
    journalEntryDraftRepository,
    journalEntryLinkGroupRepository: {
      findAllMemberships: vi.fn(async () => [
        { id: 1, linkGroupId: 5, journalEntryId: 3, createdAt: '' },
        { id: 2, linkGroupId: 5, journalEntryId: 4, createdAt: '' },
      ]),
      findAllGroups: vi.fn(async () => [{ id: 5, name: '旅行の件', createdAt: '' }]),
      joinOrCreateGroups: vi.fn(async () => undefined),
      createGroup: vi.fn(async () => ({ id: 6, name: null, createdAt: '' })),
      renameGroup: vi.fn(async () => undefined),
      removeMember: vi.fn(async () => undefined),
      moveMember: vi.fn(async () => undefined),
    },
    accountRepository: { findAll: vi.fn(async () => accounts) },
    accountGroupRepository: { findAll: vi.fn(async () => []) },
    counterpartyRepository: {
      findAll: vi.fn(async () => []),
      create: vi.fn(async (input: { name: string; counterpartyGroupId?: number | null }) => ({
        id: 50,
        name: input.name,
        defaultAccountId: null,
        counterpartyGroupId: input.counterpartyGroupId ?? null,
        sortOrder: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      })),
    },
    counterpartyGroupRepository: {
      findAll: vi.fn(async () => overrides.counterpartyGroups ?? []),
      create: vi.fn(async (input: { name: string }) => groupOf(77, input.name)),
    },
    projectRepository: {
      findAll: vi.fn(async () => []),
      create: vi.fn(async (input: { name: string; projectGroupId?: number | null }) => ({
        id: 60,
        name: input.name,
        projectGroupId: input.projectGroupId ?? null,
        sortOrder: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      })),
    },
    projectGroupRepository: {
      findAll: vi.fn(async () => overrides.projectGroups ?? []),
      create: vi.fn(async (input: { name: string }) => groupOf(88, input.name)),
    },
    householdMemberRepository: {
      findAll: vi.fn(async () => [
        { id: 1, name: '夫', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
        { id: 2, name: '妻', isGroup: false, isActive: true, createdAt: '', updatedAt: '' },
      ]),
    },
    settlementBatchRepository: {
      findAll: vi.fn(async () => [{ id: 7, name: '旅行', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' }]),
      create: vi.fn(),
    },
    recurringTransactionProposalApi,
    recurringTransactionRuleRepository: {
      findAll: vi.fn(async () => [
        {
          id: 1,
          name: 'ネット代',
          bookkeeperHouseholdMemberId: 1,
          lines: ruleLines(4, 2, 5000),
          frequency: 'monthly',
          dayOfWeek: null,
          dayOfMonth: 1,
          weekOfMonth: null,
          monthOfYear: null,
          maxOccurrences: null,
          startsOn: '2026-01-01',
          endsOn: null,
          interval: 1,
          weekendAdjustment: 'next',
          amountMode: 'last_confirmed',
          resumedOn: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          // 起票者が決まっていないルール(まとめて確定のとき、起票者を1人選ぶ必要がある)
          id: 2,
          name: 'ジム会費',
          bookkeeperHouseholdMemberId: null,
          lines: ruleLines(4, 2, 3000),
          frequency: 'monthly',
          dayOfWeek: null,
          dayOfMonth: 15,
          weekOfMonth: null,
          monthOfYear: null,
          maxOccurrences: null,
          startsOn: '2026-01-01',
          endsOn: null,
          interval: 1,
          weekendAdjustment: 'none',
          amountMode: 'fixed',
          resumedOn: null,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ]),
      create: vi.fn(async (input: Record<string, unknown>) => ({ id: 99, ...input })),
    },
    onSplit: vi.fn(),
    onProposalsChanged: vi.fn(),
    onOpenAccountReconciliation: overrides.onOpenAccountReconciliation,
    onStartStatementImport: overrides.onStartStatementImport,
    initialFilter: overrides.initialFilter,
    rulesPanel: overrides.rulesPanel,
    banner: overrides.banner,
    templatesPanel: overrides.templatesPanel,
    journalTemplateRepository: overrides.templates === undefined ? undefined : { findAll: vi.fn(async () => [...overrides.templates!]) },
    journalTemplateGroupRepository:
      overrides.templates === undefined ? undefined : { findAll: vi.fn(async () => overrides.templateGroups ?? []) },
  }
  render(
    <I18nextProvider i18n={i18n}>
      <UnsavedChangesGuardProvider>
        <LeaveProbe />
        <JournalScreen {...(props as unknown as JournalScreenProps)} />
      </UnsavedChangesGuardProvider>
    </I18nextProvider>,
  )
  return props
}

/** 借方・貸方1行ずつ(同額)のルールの行(計画Issue #180) */
function ruleLines(debitAccountId: number, creditAccountId: number, amount: number): RecurringTransactionRuleLine[] {
  const base = { projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null, amount }
  return [
    { ...base, lineNo: 1, side: 'debit', accountId: debitAccountId },
    { ...base, lineNo: 2, side: 'credit', accountId: creditAccountId },
  ]
}

const memoInput = () => within(detail()).getByLabelText('摘要(任意)')
const editMemo = (value: string) => fireEvent.change(memoInput(), { target: { value } })
const leaveDialog = () => screen.queryByRole('dialog', { name: '未保存の変更があります' })

async function ready() {
  await screen.findByRole('heading', { name: '仕訳', level: 1 })
  await screen.findByText('ランチ')
}

const detail = () => screen.getByRole('region', { name: '仕訳の詳細' })

/** 絞り込み欄は初期状態が「閉」(計画Issue #266)。閉じていれば開いてから、摘要の検索欄を返す */
function memoSearch(): HTMLElement {
  const opener = screen.queryByRole('button', { name: /^絞り込みを開く/ })
  if (opener !== null) fireEvent.click(opener)
  return screen.getByLabelText('摘要で検索')
}

describe('JournalScreen: 絞り込み欄の開閉(計画Issue #266)', () => {
  it('絞り込み欄は初期状態で閉じていて、アイコンのボタンで開閉できる', async () => {
    setup()
    await ready()
    expect(screen.queryByRole('search', { name: '仕訳の絞り込み' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを開く' }))
    expect(screen.getByRole('search', { name: '仕訳の絞り込み' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }))
    expect(screen.queryByRole('search', { name: '仕訳の絞り込み' })).not.toBeInTheDocument()
  })

  it('閉じても入力済みの条件は保たれ、ボタンの件数バッジで絞り込み中だと分かる', async () => {
    setup()
    await ready()
    fireEvent.change(memoSearch(), { target: { value: '家賃' } })
    fireEvent.click(screen.getByRole('button', { name: /^絞り込みを閉じる/ }))

    expect(screen.getByRole('button', { name: '絞り込みを開く(1件適用中)' })).toBeInTheDocument()
    expect(screen.getByTestId('filter-toggle-badge')).toHaveTextContent('1')
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^絞り込みを開く/ }))
    expect(memoSearch()).toHaveValue('家賃')
  })

  it('開閉ボタンはタブと同じ行(タブの並びと同じ容器)にあり、専用の行を取らない。タブ(tablist)の子にはしない', async () => {
    setup()
    await ready()
    const tabs = screen.getByRole('tablist', { name: '仕訳の種類' })
    const toggle = screen.getByRole('button', { name: '絞り込みを開く' })
    expect(tabs.parentElement).toContainElement(toggle)
    expect(tabs).not.toContainElement(toggle)
  })
})

describe('JournalScreen: 自動調整の仕訳(計画Issue #205)', () => {
  const autoEntry = () =>
    entry(5, '2026-09-30', '残高の自動調整(普通預金 09/01〜09/30)', 'auto_balance_adjustment', [
      line(51, 5, 'debit', 2, 500),
      line(52, 5, 'credit', 5, 500),
    ])

  it('一覧に「自動調整」のタグが出て、出どころで絞り込める', async () => {
    setup({ entries: [...makeEntries(), autoEntry()] })
    await ready()

    expect(screen.getAllByText('自動調整').length).toBeGreaterThan(0)
  })

  it('詳細パネルは読み取り専用で、自動で作られたこと・ずれた期間と内容を表示し、保存・削除・関連付けの操作を出さない', async () => {
    setup({ entries: [...makeEntries(), autoEntry()] })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /残高の自動調整/ }))

    const panel = within(detail())
    expect(panel.getByText(/自動で作られました/)).toBeInTheDocument()
    expect(panel.getByText('2026-09-01〜2026-09-30')).toBeInTheDocument()
    expect(panel.getByText('残高の自動調整(普通預金 09/01〜09/30)')).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: '保存' })).toBeNull()
    expect(panel.queryByRole('button', { name: '削除' })).toBeNull()
    expect(panel.queryByText(/関連仕訳/)).toBeNull()
  })

  it('「この期間の仕訳を見る」で、その科目・期間の仕訳に絞り込む', async () => {
    setup({ entries: [...makeEntries(), autoEntry()] })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /残高の自動調整/ }))

    fireEvent.click(within(detail()).getByRole('button', { name: 'この期間の仕訳を見る' }))

    await waitFor(() => expect(screen.queryByText('ランチ', { selector: '.journal-result-list__memo' })).toBeNull())
    expect(screen.getByText('残高の自動調整(普通預金 09/01〜09/30)', { selector: '.journal-result-list__memo' })).toBeInTheDocument()
  })

  it('「科目の照合を見る」で、対象の科目を渡して照合欄へ移る', async () => {
    const onOpenAccountReconciliation = vi.fn()
    setup({ entries: [...makeEntries(), autoEntry()], onOpenAccountReconciliation })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /残高の自動調整/ }))

    fireEvent.click(within(detail()).getByRole('button', { name: '科目の照合を見る' }))

    expect(onOpenAccountReconciliation).toHaveBeenCalledWith(2)
  })
})

describe('JournalScreen', () => {
  it('initialFilterを渡すと、その条件で絞り込んだ状態で開く(分析画面から期間・条件を引き継ぐため、計画Issue #155)', async () => {
    setup({ initialFilter: { dateFrom: '2026-10-01', dateTo: '2026-10-04', accountIds: [4] } })
    await screen.findByRole('heading', { name: '仕訳', level: 1 })
    expect(await screen.findByText('家賃', { selector: '.journal-result-list__memo' })).toBeInTheDocument()
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()
    // 絞り込み欄は閉じたまま、ボタンの件数バッジで条件が効いていると分かる(計画Issue #266)。開くと件数が出る
    expect(screen.getByRole('button', { name: /^絞り込みを開く\(\d+件適用中\)$/ })).toBeInTheDocument()
    memoSearch()
    expect(screen.getByText('1件')).toBeInTheDocument()
  })

  it('「定期仕訳にする」を押すとダイアログが開き、登録すると仕訳の行を写したルールが作られる(元の仕訳は変えない、計画Issue #180)', async () => {
    const props = setup()
    await ready()

    fireEvent.click(within(detail()).getByRole('button', { name: '定期仕訳にする' }))
    const dialog = screen.getByRole('dialog', { name: '定期仕訳の作成' })
    expect(within(dialog).getByLabelText('名称')).toHaveValue('ランチ')
    fireEvent.click(within(dialog).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(props.recurringTransactionRuleRepository.create).toHaveBeenCalledTimes(1))
    expect(props.recurringTransactionRuleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ランチ',
        frequency: 'monthly',
        dayOfMonth: 5,
        startsOn: '2026-10-06',
        lines: [
          expect.objectContaining({ side: 'debit', accountId: 1, amount: 1200 }),
          expect.objectContaining({ side: 'credit', accountId: 2, amount: 1200 }),
        ],
      }),
    )
    expect(await screen.findByText('定期仕訳を作成しました')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '定期仕訳の作成' })).not.toBeInTheDocument()
    expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
  })

  it('割勘の仕訳では「定期仕訳にする」を押せず、理由を表示する(繰り返すものではないため、計画Issue #180)', async () => {
    setup()
    await ready()

    fireEvent.click(screen.getByRole('button', { name: /割勘の夕食/ }))

    expect(within(detail()).getByRole('button', { name: '定期仕訳にする' })).toBeDisabled()
    expect(within(detail()).getByText('割勘の仕訳は一回きりの精算のため、定期仕訳にできません')).toBeInTheDocument()
  })

  it('タブは「仕訳一覧・下書き・承認待ち・定期仕訳」の順で、定期仕訳のタブには rulesPanel の中身が出る(計画Issue #180)', async () => {
    setup({ rulesPanel: <p>ルールの管理画面</p> })
    await ready()

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['仕訳一覧', '下書き 1', '承認待ち 3', '定期仕訳'])
    fireEvent.click(screen.getByRole('tab', { name: '定期仕訳' }))

    expect(await screen.findByText('ルールの管理画面')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '仕訳の詳細' })).not.toBeInTheDocument()
  })

  it('banner を渡すと、見出しの下・タブの上に出す(はじめのチェックリスト、計画Issue #177)。渡さなければ何も出さない', async () => {
    setup({ banner: <p>はじめのチェックリスト</p> })
    await ready()

    const banner = screen.getByText('はじめのチェックリスト')
    const tablist = screen.getByRole('tablist', { name: '仕訳の種類' })
    expect(banner.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('rulesPanel を渡さないときは、定期仕訳のタブを出さない', async () => {
    setup()
    await ready()

    expect(screen.queryByRole('tab', { name: '定期仕訳' })).not.toBeInTheDocument()
  })

  it('一覧と詳細が同じ画面に出て、行を選ぶと画面遷移なしで詳細が切り替わる', async () => {
    setup()
    await ready()
    expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ランチ')
    fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
    expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('家賃')
  })

  it('摘要で絞り込むと一覧が絞られ、件数が出る', async () => {
    setup()
    await ready()
    fireEvent.change(memoSearch(), { target: { value: '家賃' } })
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()
    expect(screen.getByText('1件')).toBeInTheDocument()
  })

  it('保存すると精算バッチのタグとコメントを保ったまま更新する', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(props.journalEntryRepository.update).toHaveBeenCalled())
    const [id, input] = props.journalEntryRepository.update.mock.calls[0] as unknown as [number, { comment: string; lines: { settlementBatchId?: number | null }[] }]
    expect(id).toBe(3)
    expect(input.comment).toBe('あとで精算')
    expect(input.lines.find((l) => l.settlementBatchId === 7)).toBeDefined()
  })

  it('貸借が合わないと保存せず理由を表示する', async () => {
    const props = setup()
    await ready()
    fireEvent.change(within(detail()).getByLabelText('食費の金額'), { target: { value: '1500' } })
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
    expect(await within(detail()).findByText(/貸借が一致していません/)).toBeInTheDocument()
    expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
  })

  it('精算バッチを付けられない科目だとRepositoryに拒否されたら、未収金・未払金(精算バッチ)のままにするよう表示する(計画Issue #167)', async () => {
    const props = setup()
    await ready()
    props.journalEntryRepository.update.mockRejectedValueOnce(new SettlementBatchOnNonAdvanceAccountError(1))
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
    expect(await within(detail()).findByText('精算バッチのタグが付いた明細の科目は、未収金・未払金(精算バッチ)のままにしてください。')).toBeInTheDocument()
  })

  it('削除は2回押して確定し、確認中は影響を表示して、削除後は次の仕訳を選ぶ', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: 'この仕訳を削除' }))
    expect(props.journalEntryRepository.delete).not.toHaveBeenCalled()
    expect(within(detail()).getByText(/元に戻せません/)).toBeInTheDocument()
    expect(within(detail()).getByText(/同じCSVを取り込むと、もう一度取り込まれます/)).toBeInTheDocument()
    fireEvent.click(within(detail()).getByRole('button', { name: '本当に削除する' }))
    await waitFor(() => expect(props.journalEntryRepository.delete).toHaveBeenCalledWith(2))
    await waitFor(() => expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('旅行の立替'))
  })

  it('仕訳の削除ボタンは詳細の最下部(関連仕訳より後)に、赤い塗りのボタンで置く', async () => {
    setup()
    await ready()
    const button = within(detail()).getByRole('button', { name: 'この仕訳を削除' })
    expect(button).toHaveClass('journal-screen__button--danger-solid')
    const related = within(detail()).getByRole('region', { name: '関連仕訳' })
    expect(related.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('削除をやめると何も消えない', async () => {
    const props = setup()
    await ready()
    fireEvent.click(within(detail()).getByRole('button', { name: 'この仕訳を削除' }))
    fireEvent.click(within(detail()).getByRole('button', { name: 'やめる' }))
    expect(props.journalEntryRepository.delete).not.toHaveBeenCalled()
  })

  it('精算バッチのタグがある仕訳の削除では、バッチの残高が変わる警告を出すが止めない', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: 'この仕訳を削除' }))
    expect(within(detail()).getByText(/精算バッチ「旅行」の残高が変わります/)).toBeInTheDocument()
    expect(within(detail()).getByText(/関連仕訳のグループから外れます/)).toBeInTheDocument()
    fireEvent.click(within(detail()).getByRole('button', { name: '本当に削除する' }))
    await waitFor(() => expect(props.journalEntryRepository.delete).toHaveBeenCalledWith(3))
  })

  it('割勘できない仕訳では割勘ボタンを押せず理由を表示する', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /割勘の夕食/ }))
    const button = within(detail()).getByRole('button', { name: 'この仕訳を割勘' })
    expect(button).toBeDisabled()
    expect(within(detail()).getByText('割勘で作られた仕訳は割勘できません')).toBeInTheDocument()
    expect(props.onSplit).not.toHaveBeenCalled()
  })

  it('割勘できる仕訳では割勘ボタンから onSplit を呼ぶ', async () => {
    const props = setup()
    await ready()
    fireEvent.click(within(detail()).getByRole('button', { name: 'この仕訳を割勘' }))
    expect(props.onSplit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('関連仕訳をグループ単位で詳細の最下部に出し、上部のボタンからその位置へジャンプできる', async () => {
    setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    const jump = within(detail()).getByRole('link', { name: /関連仕訳 1件/ })
    expect(jump).toHaveAttribute('href', '#related-entries')
    const related = within(detail()).getByRole('region', { name: '関連仕訳' })
    expect(within(related).getByLabelText('グループ名')).toHaveValue('旅行の件')
    expect(within(related).getByText(/割勘の夕食/)).toBeInTheDocument()
  })

  it('元の支出の詳細に、そこから生まれた割勘の履歴を出す(従来の仕訳詳細の表示を引き継ぐ)', async () => {
    // 立替金だけの仕訳は精算仕訳とみなされ履歴の起点にならないため、元の支出を費用の仕訳にする
    const originalExpense = [line(31, 3, 'debit', 1, 5000), line(32, 3, 'credit', 2, 5000)]
    setup({ entries: makeEntries().map((e) => (e.id === 3 ? { ...e, lines: originalExpense } : e)) })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    const history = within(detail()).getByRole('region', { name: 'この支出から生まれた割勘' })
    expect(within(history).getByText('割勘の夕食')).toBeInTheDocument()
  })

  it('関連仕訳のグループ名を変更できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    const input = within(detail()).getByLabelText('グループ名')
    fireEvent.change(input, { target: { value: '沖縄' } })
    fireEvent.blur(input)
    await waitFor(() => expect(props.journalEntryLinkGroupRepository.renameGroup).toHaveBeenCalledWith(5, '沖縄'))
  })

  it('関連仕訳を解除できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: /割勘の夕食.*を解除/ }))
    await waitFor(() => expect(props.journalEntryLinkGroupRepository.removeMember).toHaveBeenCalledWith(5, 4))
  })

  it('関連仕訳の「+ 新しいグループ」で仕訳を選ぶと、既存グループに合流せず新しいグループを作る', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /旅行の立替/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: '+ 新しいグループ' }))
    const popup = within(detail()).getByRole('dialog', { name: '新しいグループに関連付ける仕訳を選ぶ' })
    fireEvent.click(within(popup).getAllByRole('button', { name: /ランチ/ })[0])
    await waitFor(() =>
      expect(props.journalEntryLinkGroupRepository.createGroup).toHaveBeenCalledWith([expect.any(Number), expect.any(Number)]),
    )
    expect(props.journalEntryLinkGroupRepository.joinOrCreateGroups).not.toHaveBeenCalled()
  })

  it('新規仕訳で保存して続けて入力すると、作成して空の新しい仕訳が開く', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
    expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('')
    expect(within(detail()).getByRole('heading', { name: '新しい仕訳' })).toBeInTheDocument()
    // 科目を選ばずに保存しようとしても作成されない
    fireEvent.click(within(detail()).getByRole('button', { name: '保存して続けて入力' }))
    expect(props.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  describe('明細行の取引先・プロジェクトの追加ダイアログ(計画Issue #207)', () => {
    /** 新規仕訳を開き、借方の科目に食費(費用)を選ぶ。取引先の欄が出る */
    async function openEditorWithExpense(overrides: Parameters<typeof setup>[0] = {}) {
      const props = setup(overrides)
      await ready()
      fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
      fireEvent.click(within(detail()).getAllByRole('button', { name: /^科目/ })[0])
      fireEvent.click(within(screen.getByRole('dialog', { name: '科目' })).getByRole('button', { name: '食費' }))
      return props
    }
    const dialog = (name: string) => within(screen.getByRole('dialog', { name }))

    it('プロジェクトの追加ダイアログにグループ欄が出て、すでにあるグループを選ぶと、そのグループで作られる', async () => {
      const props = await openEditorWithExpense({ projectGroups: [groupOf(3, '旅行系')] })

      fireEvent.click(within(detail()).getAllByRole('button', { name: /^プロジェクト/ })[0])
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクト' })).getByRole('button', { name: /新規追加/ }))
      expect(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ: 未分類/ })).toBeInTheDocument()
      fireEvent.change(dialog('プロジェクトを追加').getByLabelText('プロジェクト名'), { target: { value: '夏の旅行' } })
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: /^プロジェクトグループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'プロジェクトグループ' })).getByRole('button', { name: '旅行系' }))
      fireEvent.click(dialog('プロジェクトを追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(props.projectRepository.create).toHaveBeenCalledWith({ name: '夏の旅行', projectGroupId: 3 }))
    })

    it('取引先の追加ダイアログで、グループをその場で作って選べる(グループは名前だけで作る)。キャンセルしたら何も作らない', async () => {
      const props = await openEditorWithExpense()

      fireEvent.click(within(detail()).getAllByRole('button', { name: /^取引先/ })[0])
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先' })).getByRole('button', { name: /新規追加/ }))
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: /^取引先グループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先グループ' })).getByRole('button', { name: '+ グループを新規追加' }))
      fireEvent.change(dialog('取引先グループを追加').getByLabelText('グループ名'), { target: { value: '取り消す系' } })
      fireEvent.click(dialog('取引先グループを追加').getByRole('button', { name: 'キャンセル' }))
      expect(props.counterpartyGroupRepository.create).not.toHaveBeenCalled()

      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: /^取引先グループ/ }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '取引先グループ' })).getByRole('button', { name: '+ グループを新規追加' }))
      fireEvent.change(dialog('取引先グループを追加').getByLabelText('グループ名'), { target: { value: '新しい系' } })
      fireEvent.click(dialog('取引先グループを追加').getByRole('button', { name: '追加' }))
      await waitFor(() => expect(props.counterpartyGroupRepository.create).toHaveBeenCalledWith({ name: '新しい系' }))
      expect(await dialog('取引先を追加').findByRole('button', { name: /^取引先グループ: 新しい系/ })).toBeInTheDocument()
      fireEvent.change(dialog('取引先を追加').getByLabelText('取引先名'), { target: { value: '新しい店' } })
      fireEvent.click(dialog('取引先を追加').getByRole('button', { name: '追加' }))

      await waitFor(() => expect(props.counterpartyRepository.create).toHaveBeenCalledWith({ name: '新しい店', counterpartyGroupId: 77 }))
    })
  })

  it('既存の仕訳の編集には「保存して続けて入力」を出さない(新規仕訳にだけ出す)', async () => {
    setup()
    await ready()
    expect(within(detail()).queryByRole('button', { name: '保存して続けて入力' })).not.toBeInTheDocument()
    expect(within(detail()).getByRole('button', { name: '保存' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
    expect(within(detail()).getByRole('button', { name: '保存して続けて入力' })).toBeInTheDocument()
  })

  describe('起票者と明細行の世帯メンバー(計画Issue #169)', () => {
    it('起票者を変えて保存すると、更新に起票者が渡り、手で変えていない明細行も追従する', async () => {
      const props = setup()
      await ready()
      chooseMember('起票者', '妻', within(detail()))
      fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))

      await waitFor(() =>
        expect(props.journalEntryRepository.update).toHaveBeenCalledWith(
          1,
          expect.objectContaining({
            householdMemberId: 2,
            lines: [
              expect.objectContaining({ accountId: 1, householdMemberId: 2 }),
              expect.objectContaining({ accountId: 2, householdMemberId: 2 }),
            ],
          }),
        ),
      )
    })

    it('新規仕訳では、明細行の世帯メンバーの既定値は起票者(有効な最初のメンバー)になる', async () => {
      setup()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))

      expectMembers('世帯メンバー', ['夫', '夫'], within(detail()))
    })

    it('世帯メンバーが入っていない下書きの行は、再開すると起票者で補われて確定できる', async () => {
      setup({ drafts: [balancedDraft(101, '確定する下書き')] })
      await ready()
      fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
      fireEvent.click(await screen.findByRole('button', { name: /確定する下書き/ }))

      expectMembers('世帯メンバー', ['夫', '夫'], within(detail()))
      expect(within(detail()).getByRole('button', { name: '確定して仕訳にする' })).toBeEnabled()
    })
  })

  describe('未保存の変更があるまま移動しようとしたとき', () => {
    it('編集していなければ、別の仕訳を選んでもダイアログを出さずに切り替わる', async () => {
      setup()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(memoInput()).toHaveValue('家賃')
    })

    it('編集して別の仕訳を選ぶと、保存するか破棄するかを聞き、キャンセルすれば編集中の内容が残る', async () => {
      const props = setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      expect(leaveDialog()).toBeInTheDocument()
      expect(memoInput()).toHaveValue('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(memoInput()).toHaveValue('ランチ(修正中)')
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('「破棄して移動」を選ぶと、保存せずに選んだ仕訳へ移る', async () => {
      const props = setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(memoInput()).toHaveValue('家賃')
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('「保存して移動」を選ぶと、編集中の仕訳を保存してから選んだ仕訳へ移る', async () => {
      const props = setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
      await waitFor(() => expect(props.journalEntryRepository.update).toHaveBeenCalledWith(1, expect.objectContaining({ memo: 'ランチ(修正中)' })))
      await waitFor(() => expect(memoInput()).toHaveValue('家賃'))
      expect(leaveDialog()).not.toBeInTheDocument()
    })

    it('「保存して移動」で保存できなかったとき(確定済みの仕訳の保存が失敗)は、移動せず編集中の内容と理由を残す', async () => {
      const props = setup()
      props.journalEntryRepository.update.mockRejectedValueOnce(new Error('failed'))
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('更新に失敗しました')
      expect(memoInput()).toHaveValue('ランチ(修正中)')
    })

    it('編集してタブを切り替えるときも確認する', async () => {
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
      expect(leaveDialog()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(screen.getByRole('tab', { name: /下書き/ })).toHaveAttribute('aria-selected', 'true')
    })

    it('編集してから「手入力で起票」を押すときも確認する', async () => {
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
      expect(leaveDialog()).toBeInTheDocument()
      expect(memoInput()).toHaveValue('ランチ(修正中)')
    })

    it('下書きを編集して移動するときは、「保存して移動」で下書きとして保存する', async () => {
      const props = setup()
      await ready()
      fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
      fireEvent.click(await screen.findByRole('button', { name: /書きかけ/ }))
      editMemo('書きかけ(修正)')
      fireEvent.click(screen.getByRole('tab', { name: '仕訳一覧' }))
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
      await waitFor(() => expect(props.journalEntryDraftRepository.update).toHaveBeenCalledWith(100, expect.objectContaining({ memo: '書きかけ(修正)' })))
      await waitFor(() => expect(screen.getByRole('tab', { name: '仕訳一覧' })).toHaveAttribute('aria-selected', 'true'))
    })

    it('保存した直後は未保存ではなくなり、続けて別の仕訳を選んでもダイアログを出さない', async () => {
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
      await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      expect(leaveDialog()).not.toBeInTheDocument()
    })

    it('画面の外(サイドナビなど)への移動も、未保存の変更があるときだけ確認し、破棄すると続行する', async () => {
      leaveSpy.mockClear()
      setup()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: 'テスト用: 画面を離れる' }))
      expect(leaveSpy).toHaveBeenCalledTimes(1)
      leaveSpy.mockClear()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: 'テスト用: 画面を離れる' }))
      expect(leaveSpy).not.toHaveBeenCalled()
      expect(leaveDialog()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(leaveSpy).toHaveBeenCalledTimes(1)
    })

    it('リロードやタブを閉じるときは、未保存の変更があるときだけブラウザ標準の確認を出す', async () => {
      setup()
      await ready()
      const clean = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(clean)
      expect(clean.defaultPrevented).toBe(false)
      editMemo('ランチ(修正中)')
      const dirty = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(dirty)
      expect(dirty.defaultPrevented).toBe(true)
    })
  })

  describe('未保存の警告を出さない設定のとき(計画Issue #190)', () => {
    it('編集していても、別の仕訳を選ぶと確認なしで切り替わる', async () => {
      saveUnsavedWarningEnabled(false)
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(memoInput()).toHaveValue('家賃')
    })

    it('編集していても、画面の外への移動は確認なしで続行され、リロードの警告も出ない', async () => {
      saveUnsavedWarningEnabled(false)
      leaveSpy.mockClear()
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: 'テスト用: 画面を離れる' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(leaveSpy).toHaveBeenCalledTimes(1)
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    })
  })

  it('貸借が合った下書きを確定すると draft.confirm が呼ばれ、ほかに下書きが無ければ仕訳一覧タブへ戻る', async () => {
    const props = setup({ drafts: [balancedDraft(101, '確定する下書き')] })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
    fireEvent.click(await screen.findByRole('button', { name: /確定する下書き/ }))
    const confirm = within(detail()).getByRole('button', { name: '確定して仕訳にする' })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(props.journalEntryDraftRepository.confirm).toHaveBeenCalledWith(101))
    await waitFor(() => expect(screen.getByRole('tab', { name: '仕訳一覧' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('下書きを確定すると、下書きタブに別の下書きが残っていればその下書きが選ばれる', async () => {
    const props = setup({ drafts: [balancedDraft(101, '確定する下書き'), balancedDraft(102, '次の下書き')] })
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
    fireEvent.click(await screen.findByRole('button', { name: /確定する下書き/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: '確定して仕訳にする' }))

    await waitFor(() => expect(props.journalEntryDraftRepository.confirm).toHaveBeenCalledWith(101))
    await waitFor(() => expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('次の下書き'))
    expect(screen.getByRole('tab', { name: /下書き/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('下書きタブで下書きを選び、貸借が合わなくても下書きとして保存できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
    fireEvent.click(await screen.findByRole('button', { name: /書きかけ/ }))
    expect(within(detail()).getByRole('button', { name: '確定して仕訳にする' })).toBeDisabled()
    fireEvent.click(within(detail()).getByRole('button', { name: '下書きを保存' }))
    await waitFor(() => expect(props.journalEntryDraftRepository.update).toHaveBeenCalledWith(100, expect.anything()))
  })

  describe('新規仕訳の「下書きに保存」(計画Issue #183)', () => {
    /** 新規仕訳を開き、「下書きに保存」を押す */
    async function saveNewAsDraft(prepare: () => void = () => {}) {
      const props = setup()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
      prepare()
      fireEvent.click(within(detail()).getByRole('button', { name: '下書きに保存' }))
      return props
    }

    it('何も入力していなくても(科目・金額・世帯メンバー・摘要が未入力)、下書きとして保存できる', async () => {
      const props = await saveNewAsDraft()

      await waitFor(() => expect(props.journalEntryDraftRepository.create).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('取引日を消した状態でも、日付なし(null)の下書きとして保存できる', async () => {
      const props = await saveNewAsDraft(() => {
        fireEvent.change(within(detail()).getByLabelText('取引日'), { target: { value: '' } })
      })

      await waitFor(() => expect(props.journalEntryDraftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ entryDate: null })))
    })

    it('摘要だけ入力した状態でも保存でき、入力した摘要が渡る', async () => {
      const props = await saveNewAsDraft(() => editMemo('途中のメモ'))

      await waitFor(() =>
        expect(props.journalEntryDraftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ memo: '途中のメモ' })),
      )
    })
  })

  it('未入力が多い新規仕訳を編集して移動するときは、「保存して移動」で下書きとして保存し、検証エラーで移動が止まらない(計画Issue #183)', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
    editMemo('書きかけの新規')
    fireEvent.click(screen.getByRole('tab', { name: '下書き 1' }))
    fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))

    await waitFor(() =>
      expect(props.journalEntryDraftRepository.create).toHaveBeenCalledWith(expect.objectContaining({ memo: '書きかけの新規' })),
    )
    expect(props.journalEntryRepository.create).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('tab', { name: /下書き/ })).toHaveAttribute('aria-selected', 'true'))
  })

  it('下書きを削除できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
    fireEvent.click(await screen.findByRole('button', { name: /書きかけ/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: '削除' }))
    await waitFor(() => expect(props.journalEntryDraftRepository.delete).toHaveBeenCalledWith(100))
  })

  it('承認待ちの定期仕訳タブでは古い順に並び、先頭の提案を金額修正して確定できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /^承認待ち/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    expect(rows[0]).toHaveTextContent('2026')
    fireEvent.click(rows[0])
    fireEvent.change(within(detail()).getByLabelText('家賃の金額'), { target: { value: '5500' } })
    fireEvent.click(within(detail()).getByRole('button', { name: '承認して仕訳帳に反映' }))
    await waitFor(() =>
      expect(props.recurringTransactionProposalApi.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleId: 1,
          dueDate: '2026-10-01',
          lines: [
            expect.objectContaining({ accountId: 4, side: 'debit', amount: 5500 }),
            expect.objectContaining({ accountId: 2, side: 'credit', amount: 5500 }),
          ],
        }),
      ),
    )
  })

  it('同じルールの古い提案が残っていると確定も見送りもできず理由を表示する', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /^承認待ち/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    fireEvent.click(rows[1])
    expect(within(detail()).getByRole('button', { name: '承認して仕訳帳に反映' })).toBeDisabled()
    expect(within(detail()).getByRole('button', { name: '今回は見送る' })).toBeDisabled()
    expect(within(detail()).getByText('先に同じルールの古い提案を確定するか見送ってください')).toBeInTheDocument()
    expect(props.recurringTransactionProposalApi.skip).not.toHaveBeenCalled()
  })

  it('提案を見送ると skip を呼ぶ', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /^承認待ち/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    fireEvent.click(rows[0])
    fireEvent.click(within(detail()).getByRole('button', { name: '今回は見送る' }))
    await waitFor(() =>
      expect(props.recurringTransactionProposalApi.skip).toHaveBeenCalledWith({ ruleId: 1, dueDate: '2026-10-01' }),
    )
  })

  describe('承認待ちの定期仕訳タブ(計画Issue #164)', () => {
    async function openProposals() {
      const props = setup()
      await ready()
      fireEvent.click(screen.getByRole('tab', { name: /^承認待ち/ }))
      await screen.findAllByRole('button', { name: /ネット代/ })
      return props
    }
    const checkbox = (name: RegExp) => screen.getAllByRole('checkbox', { name })

    it('一覧には科目(借方 / 貸方)を表示しない', async () => {
      await openProposals()

      for (const row of screen.getAllByRole('button', { name: /ネット代|ジム会費/ })) {
        expect(row).not.toHaveTextContent(' / ')
        expect(row).not.toHaveTextContent('家賃')
      }
    })

    it('一覧の日付は土日の調整後の日付で、ずらした提案には期日を添える', async () => {
      await openProposals()

      const adjusted = screen.getAllByRole('button', { name: /ネット代/ })[1]
      expect(adjusted).toHaveTextContent('2026/11/2')
      expect(adjusted).toHaveTextContent('期日 2026/11/1')
    })

    it('チェックを付けたあとに Esc を押すと、すべてのチェックが外れる(計画Issue #235 D)', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ジム会費/)[0])
      fireEvent.click(checkbox(/ネット代/)[1], { shiftKey: true })
      expect(screen.getByText('3件を選択中')).toBeInTheDocument()
      fireEvent.keyDown(checkbox(/ジム会費/)[0], { key: 'Escape' })

      expect(screen.getByText('0件を選択中')).toBeInTheDocument()
      expect(checkbox(/ジム会費/)[0]).not.toBeChecked()
    })

    it('Shift+クリックで範囲選択しても、同じルールの提案は古い順に途切れず選ばれる(計画Issue #235 D)', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ジム会費/)[0])
      // 範囲は「ジム会費(10/15)」から「ネット代(11/1期日)」まで。ネット代の古い方(10/1)も連動して付く
      fireEvent.click(checkbox(/ネット代/)[1], { shiftKey: true })

      expect(screen.getByText('3件を選択中')).toBeInTheDocument()
      expect(checkbox(/ネット代/)[0]).toBeChecked()
    })

    it('Ctrl+クリックで古い提案のチェックを外すと、同じルールのそれより新しい提案も外れる(計画Issue #235 D)', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ジム会費/)[0])
      fireEvent.click(checkbox(/ネット代/)[1], { shiftKey: true })
      fireEvent.click(checkbox(/ネット代/)[0], { ctrlKey: true })

      expect(screen.getByText('1件を選択中')).toBeInTheDocument()
      expect(checkbox(/ネット代/)[1]).not.toBeChecked()
      expect(checkbox(/ジム会費/)[0]).toBeChecked()
    })

    it('詳細パネルの摘要の初期値はルール名で、金額の初期値と土日の調整後の日付が出る', async () => {
      await openProposals()

      fireEvent.click(screen.getAllByRole('button', { name: /ネット代/ })[1])

      expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ネット代')
      expect(within(detail()).getByLabelText('家賃の金額')).toHaveValue('5200')
      expect(within(detail()).getByLabelText('取引日')).toHaveValue('2026-11-02')
    })

    it('摘要とコメントを直して確定すると、その摘要とコメントを渡す', async () => {
      const props = await openProposals()

      fireEvent.click(screen.getAllByRole('button', { name: /ネット代/ })[0])
      fireEvent.change(within(detail()).getByLabelText('摘要(任意)'), { target: { value: 'ネット代 10月分' } })
      fireEvent.change(within(detail()).getByLabelText('コメント(任意)'), { target: { value: 'プラン変更あり' } })
      fireEvent.click(within(detail()).getByRole('button', { name: '承認して仕訳帳に反映' }))

      await waitFor(() =>
        expect(props.recurringTransactionProposalApi.confirm).toHaveBeenCalledWith(
          expect.objectContaining({
            ruleId: 1,
            dueDate: '2026-10-01',
            memo: 'ネット代 10月分',
            comment: 'プラン変更あり',
          }),
        ),
      )
    })

    it('確認パネルは仕訳の起票と同じ編集画面で、科目・金額の変更や行の追加・削除ができる(取引日と起票者は変えられない)', async () => {
      await openProposals()

      fireEvent.click(screen.getAllByRole('button', { name: /ネット代/ })[0])

      const debitColumn = within(within(detail()).getByRole('group', { name: '借方' }))
      expect(debitColumn.getByRole('button', { name: /^プロジェクト/ })).toBeEnabled()
      expect(findMemberButton('世帯メンバー', debitColumn)).toBeEnabled()
      expect(debitColumn.getByRole('button', { name: '+ 借方の行を追加' })).toBeEnabled()
      expect(within(detail()).getByLabelText('取引日')).toBeDisabled()
    })

    it('確認パネルで行を追加すると貸借の差額が出る(科目を選ぶまで、確定のRPCは呼ばれない)', async () => {
      const props = await openProposals()

      fireEvent.click(screen.getAllByRole('button', { name: /ネット代/ })[0])
      fireEvent.click(within(detail()).getByRole('button', { name: '+ 借方の行を追加' }))
      const amounts = within(within(detail()).getByRole('group', { name: '借方' })).getAllByLabelText(/金額/)
      fireEvent.change(amounts[1], { target: { value: '300' } })

      expect(within(detail()).getByRole('status')).toHaveTextContent('差額')
      expect(props.recurringTransactionProposalApi.confirm).not.toHaveBeenCalled()
    })

    it('新しい提案にチェックを付けると、同じルールの古い提案にもチェックが付く(別のルールは付かない)', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ネット代/)[1])

      expect(checkbox(/ネット代/)[0]).toBeChecked()
      expect(checkbox(/ネット代/)[1]).toBeChecked()
      expect(checkbox(/ジム会費/)[0]).not.toBeChecked()
      expect(screen.getByText('2件を選択中')).toBeInTheDocument()
    })

    it('古い提案のチェックを外すと、同じルールの新しい提案のチェックも外れる', async () => {
      await openProposals()
      fireEvent.click(checkbox(/ネット代/)[1])

      fireEvent.click(checkbox(/ネット代/)[0])

      expect(checkbox(/ネット代/)[0]).not.toBeChecked()
      expect(checkbox(/ネット代/)[1]).not.toBeChecked()
    })

    it('チェックを付けただけでは詳細の選択は変わらない。チェックがない間は、行を押すと詳細が開き、チェックは変わらない', async () => {
      await openProposals()

      fireEvent.click(screen.getAllByRole('button', { name: /ジム会費/ })[0])
      expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ジム会費')
      expect(checkbox(/ジム会費/)[0]).not.toBeChecked()

      fireEvent.click(checkbox(/ネット代/)[0])
      expect(checkbox(/ネット代/)[0]).toBeChecked()
      expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ジム会費')
    })

    it('チェックが1件でもあるときは、行のどこを押してもチェックの操作になり、詳細は開かない(計画Issue #235 D)', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ネット代/)[0])
      fireEvent.click(screen.getAllByRole('button', { name: /ジム会費/ })[0])

      expect(checkbox(/ジム会費/)[0]).toBeChecked()
      expect(checkbox(/ネット代/)[0]).toBeChecked()
      expect(screen.getByText('2件を選択中')).toBeInTheDocument()
      // 詳細は、最初に開いていた提案(ネット代)のまま
      expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ネット代')
    })

    it('すべて選択でチェックが全件に付き、もう一度押すと全部外れる', async () => {
      await openProposals()

      fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))
      expect(screen.getByText('3件を選択中')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))

      expect(screen.getByText('0件を選択中')).toBeInTheDocument()
    })

    it('何もチェックしていないときは「選択した定期仕訳を承認して反映」が押せない', async () => {
      await openProposals()

      expect(screen.getByRole('button', { name: '選択した定期仕訳を承認して反映' })).toBeDisabled()
    })

    it('選択した定期仕訳を承認して反映すると、選んだ提案をconfirmManyで確定する(金額は渡さず、初期値のまま)', async () => {
      const props = await openProposals()
      fireEvent.click(checkbox(/ネット代/)[1])

      fireEvent.click(screen.getByRole('button', { name: '選択した定期仕訳を承認して反映' }))

      await waitFor(() =>
        expect(props.recurringTransactionProposalApi.confirmMany).toHaveBeenCalledWith({
          items: [
            { ruleId: 1, dueDate: '2026-10-01' },
            { ruleId: 1, dueDate: '2026-11-01' },
          ],
          householdMemberId: undefined,
        }),
      )
      expect(await screen.findByText('2件の仕訳を仕訳帳に反映しました')).toBeInTheDocument()
    })

    it('起票者が決まっていないルールを選ぶと、まとめて起票者を選ぶまで確定できず、選ぶとその起票者で確定する', async () => {
      const props = await openProposals()
      fireEvent.click(checkbox(/ジム会費/)[0])

      const confirmButton = screen.getByRole('button', { name: '選択した定期仕訳を承認して反映' })
      expect(confirmButton).toBeDisabled()
      expect(screen.getByText(/起票者が決まっていない提案\(ジム会費\)があります/)).toBeInTheDocument()
      chooseMember('まとめて確定の起票者', '妻')
      expect(confirmButton).toBeEnabled()
      fireEvent.click(confirmButton)

      await waitFor(() =>
        expect(props.recurringTransactionProposalApi.confirmMany).toHaveBeenCalledWith({
          items: [{ ruleId: 2, dueDate: '2026-10-15' }],
          householdMemberId: 2,
        }),
      )
    })

    it('起票者が決まっているルールだけを選んだときは、起票者の選択は出ない', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ネット代/)[0])

      expect(screen.queryByRole('button', { name: /^まとめて確定の起票者/ })).not.toBeInTheDocument()
    })

    it('まとめて確定に失敗したら、エラーを表示する(確定したことにならない)', async () => {
      const props = await openProposals()
      props.recurringTransactionProposalApi.confirmMany.mockRejectedValueOnce(new Error('boom'))
      fireEvent.click(checkbox(/ネット代/)[0])

      fireEvent.click(screen.getByRole('button', { name: '選択した定期仕訳を承認して反映' }))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByText('1件の仕訳を仕訳帳に反映しました')).not.toBeInTheDocument()
    })
  })
})

/**
 * 仕訳画面の「明細行単位」の表示方式(計画Issue #182)。仕訳一覧タブに「仕訳単位 / 明細行単位」の切替があり、
 * 切り替えても選択・フィルタは仕訳単位で動くこと、明細行単位では詳細パネルを出さず表でインライン編集できること
 * (保存・キャンセル・削除の2回押し・貸借が合わない間は保存不可・既存の未保存ガード)、下書き・承認待ちタブには
 * 切替が出ないこと、選んだ表示方式がlocalStorageに保存され再訪時に復元されること(初期値は仕訳単位)を検証する。
 */
describe('JournalScreen(明細行単位)', () => {
  const VIEW_KEY = 'localbudget:journal-view-mode'
  const viewToggle = () => screen.getByRole('group', { name: '表示方式' })
  const switchTo = (name: '仕訳単位' | '明細行単位') => fireEvent.click(within(viewToggle()).getByRole('button', { name }))
  const lineTable = () => screen.getByRole('table', { name: '仕訳の明細行' })

  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  /** 明細行単位で開いた状態にする(保存済みの表示方式を復元させる) */
  async function setupLineView(overrides: Parameters<typeof setup>[0] = {}) {
    localStorage.setItem(VIEW_KEY, 'line')
    const props = setup(overrides)
    await ready()
    return props
  }

  describe('表示方式の切替と保持', () => {
    it('仕訳一覧タブに「仕訳単位 / 明細行単位」の切替があり、初期値は仕訳単位(従来の一覧と詳細パネル)', async () => {
      setup()
      await ready()
      expect(within(viewToggle()).getByRole('button', { name: '仕訳単位' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(viewToggle()).getByRole('button', { name: '明細行単位' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.queryByRole('table', { name: '仕訳の明細行' })).not.toBeInTheDocument()
      expect(detail()).toBeInTheDocument()
    })

    it('明細行単位に切り替えると表になり、詳細パネルと従来の一覧は出ない。仕訳単位に戻すと元に戻る', async () => {
      setup()
      await ready()
      switchTo('明細行単位')
      expect(lineTable()).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '仕訳の詳細' })).not.toBeInTheDocument()
      switchTo('仕訳単位')
      expect(screen.queryByRole('table', { name: '仕訳の明細行' })).not.toBeInTheDocument()
      expect(detail()).toBeInTheDocument()
    })

    it('明細行単位のときだけ「列幅を初期値に戻す」が表示方式の切替の左隣に出て、列幅を変えると押せる', async () => {
      setup()
      await ready()
      expect(screen.queryByRole('button', { name: '列幅を初期値に戻す' })).not.toBeInTheDocument()
      switchTo('明細行単位')
      const reset = screen.getByRole('button', { name: '列幅を初期値に戻す' })
      expect(reset).toBeDisabled()
      expect(reset.compareDocumentPosition(viewToggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(reset.parentElement).toBe(viewToggle().parentElement)
      fireEvent.keyDown(within(lineTable()).getByRole('separator', { name: '日付の列幅' }), { key: 'ArrowRight' })
      expect(reset).toBeEnabled()
      fireEvent.click(reset)
      expect(reset).toBeDisabled()
    })

    it('選んだ表示方式をlocalStorageに保存し、再訪時に明細行単位で開く', async () => {
      setup()
      await ready()
      switchTo('明細行単位')
      expect(localStorage.getItem(VIEW_KEY)).toBe('line')
      cleanup()

      setup()
      await ready()
      expect(lineTable()).toBeInTheDocument()
      switchTo('仕訳単位')
      expect(localStorage.getItem(VIEW_KEY)).toBe('entry')
    })

    it('下書き・承認待ちのタブには切替が出ず、従来の一覧のまま(明細行単位を選んでいても)', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
      expect(await screen.findByText('書きかけ')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '表示方式' })).not.toBeInTheDocument()
      expect(screen.queryByRole('table', { name: '仕訳の明細行' })).not.toBeInTheDocument()
      expect(detail()).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: /仕訳一覧/ }))
      expect(await screen.findByRole('table', { name: '仕訳の明細行' })).toBeInTheDocument()
    })
  })

  describe('表示と選択・絞り込み(仕訳単位のまま動く)', () => {
    it('表に全仕訳の明細行が並び、複合でない仕訳は借方と貸方が同じ行に出る', async () => {
      await setupLineView()
      const row = screen.getByRole('button', { name: 'ランチ' }).closest('tr') as HTMLElement
      expect(within(row).getByText('食費')).toBeInTheDocument()
      expect(within(row).getByText('普通預金')).toBeInTheDocument()
    })

    it('摘要で絞り込むと、明細行単位でも表が絞られ、件数が出る', async () => {
      await setupLineView()
      fireEvent.change(memoSearch(), { target: { value: '家賃' } })
      expect(screen.queryByRole('button', { name: 'ランチ' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '家賃' })).toBeInTheDocument()
      expect(screen.getByText('1件')).toBeInTheDocument()
    })

    it('開いた直後は、先頭の仕訳が選択状態で強調されるだけで、編集は始まっていない', async () => {
      await setupLineView()
      expect(screen.getByRole('button', { name: 'ランチ' }).closest('tr')).toHaveAttribute('aria-current', 'true')
      expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument()
    })

    it('表の行を押すと、その仕訳が選ばれて編集できる状態になり、仕訳単位に切り替えるとその仕訳の詳細が開く', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: '家賃' }))
      expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
      switchTo('仕訳単位')
      expect(memoInput()).toHaveValue('家賃')
    })

    it('「手入力で起票」を押すと、入力欄のある仕訳単位の画面で開く。保存した表示方式は変わらない', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
      expect(screen.getByRole('heading', { name: '新しい仕訳' })).toBeInTheDocument()
      expect(screen.queryByRole('table', { name: '仕訳の明細行' })).not.toBeInTheDocument()
      expect(localStorage.getItem(VIEW_KEY)).toBe('line')
    })
  })

  describe('インライン編集', () => {
    it('行を押すと(編集ボタンはない)、その仕訳の全行が入力欄になる。他の仕訳は閲覧のまま', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      expect(screen.getByLabelText('摘要')).toHaveValue('ランチ')
      expect(screen.getByLabelText('借方の金額')).toHaveValue('1200')
      expect(screen.getByLabelText('貸方の金額')).toHaveValue('1200')
      expect(screen.getAllByLabelText('摘要')).toHaveLength(1)
      expect(screen.getByRole('button', { name: '家賃' })).toBeInTheDocument()
    })

    it('金額を直して貸借が合っていれば保存でき、保存すると表の閲覧に戻る', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('借方の金額'), { target: { value: '1500' } })
      fireEvent.change(screen.getByLabelText('貸方の金額'), { target: { value: '1500' } })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))

      await waitFor(() => expect(props.journalEntryRepository.update).toHaveBeenCalledTimes(1))
      const [id, input] = props.journalEntryRepository.update.mock.calls[0] as unknown as [number, { lines: { amount: number }[] }]
      expect(id).toBe(1)
      expect(input.lines.map((l) => l.amount)).toEqual([1500, 1500])
      await waitFor(() => expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'ランチ' })).toBeInTheDocument()
    })

    it('貸借が合わない間は、差額を表示して保存できず、Repositoryも呼ばれない', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('借方の金額'), { target: { value: '1500' } })
      expect(within(lineTable()).getByRole('status')).toHaveTextContent('貸借が合っていません')
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('科目が未選択の行があるなど、保存できない理由は操作バーに表示し、保存しない', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.click(screen.getByRole('button', { name: '+ 借方の行' }))
      fireEvent.change(screen.getAllByLabelText('借方の金額')[1], { target: { value: '300' } })
      fireEvent.change(screen.getByLabelText('貸方の金額'), { target: { value: '1500' } })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('保存できません')
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('「キャンセル」で編集前の内容に戻り、保存しない', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチ(修正中)' } })
      fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ランチ' })).toBeInTheDocument()
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
      // もう一度開くと、修正中の内容は残っていない
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      expect(screen.getByLabelText('摘要')).toHaveValue('ランチ')
    })

    it('削除は2回押して確定する(確認中は元に戻せない旨を表示し、「やめる」で何も消えない)', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.click(screen.getByRole('button', { name: '仕訳を削除' }))
      expect(props.journalEntryRepository.delete).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent('この仕訳を削除します。元に戻せません。')

      fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(screen.queryByRole('button', { name: '本当に削除する' })).not.toBeInTheDocument()
      expect(props.journalEntryRepository.delete).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: '仕訳を削除' }))
      fireEvent.click(screen.getByRole('button', { name: '本当に削除する' }))
      await waitFor(() => expect(props.journalEntryRepository.delete).toHaveBeenCalledWith(1))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'ランチ' })).not.toBeInTheDocument())
    })
  })

  describe('未保存の変更があるまま移動しようとしたとき(既存の未保存ガード)', () => {
    it('編集中に別の仕訳の行を押すと、保存か破棄かを聞き、キャンセルすれば編集中の内容が残る', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチ(修正中)' } })
      fireEvent.click(screen.getByRole('button', { name: '家賃' }))
      expect(leaveDialog()).toBeInTheDocument()
      // 表の操作バーにも「キャンセル」があるため、未保存ガードのダイアログの中で選ぶ
      fireEvent.click(within(leaveDialog() as HTMLElement).getByRole('button', { name: 'キャンセル' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(screen.getByLabelText('摘要')).toHaveValue('ランチ(修正中)')
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('「破棄して移動」を選ぶと、保存せずに選んだ仕訳の編集に移る', async () => {
      const props = await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチ(修正中)' } })
      fireEvent.click(screen.getByRole('button', { name: '家賃' }))
      fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
      expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
    })

    it('変更がなければ、別の仕訳の行を押して編集に移ってもダイアログを出さない', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.click(screen.getByRole('button', { name: '家賃' }))
      expect(leaveDialog()).not.toBeInTheDocument()
      expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
    })

    it('編集中に仕訳単位へ切り替えようとしても、保存か破棄かを聞く', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('button', { name: 'ランチ' }))
      fireEvent.change(screen.getByLabelText('摘要'), { target: { value: 'ランチ(修正中)' } })
      switchTo('仕訳単位')
      expect(leaveDialog()).toBeInTheDocument()
      expect(screen.getByRole('table', { name: '仕訳の明細行' })).toBeInTheDocument()
    })
  })

  /**
   * 一括編集(計画Issue #182): 明細行単位の表で、明細の行を仕訳をまたいで選び、科目・プロジェクト・取引先・
   * 精算バッチ・世帯メンバーをまとめて変える。選べない項目の先回りの無効化、適用の2回押し、1件の仕訳ずつの保存と
   * 結果の報告(失敗した仕訳の行は選択したまま)、インライン編集・絞り込み・表示方式の切替との整合を検証する。
   */
  describe('一括編集', () => {
    /** 摘要(ボタン)から、その仕訳の先頭行を得る */
    const rowOf = (memo: string) => screen.getByRole('button', { name: memo }).closest('tr') as HTMLElement
    const debitBox = (memo: string) => within(rowOf(memo)).getByRole('checkbox', { name: '借方の行を選択' })
    const creditBox = (memo: string) => within(rowOf(memo)).getByRole('checkbox', { name: '貸方の行を選択' })
    const bulkBar = () => screen.getByRole('region', { name: '一括編集' })
    const chooseAccount = (option: string) => {
      fireEvent.click(within(bulkBar()).getByRole('button', { name: '一括編集の科目: 変更しない' }))
      fireEvent.click(within(screen.getByRole('dialog', { name: '一括編集の科目' })).getByRole('button', { name: option }))
    }
    const apply = () => within(bulkBar()).getByRole('button', { name: /行に適用$/ })
    /** 科目・取引先以外の項目は「その他の項目」を開くと出る(計画Issue #266)。バーが出し直されると畳まれるので、使う直前に開く */
    const openMore = () => fireEvent.click(within(bulkBar()).getByRole('button', { name: /^その他の項目/ }))
    /** 適用の確認は、固定バーを高くしないよう、ダイアログで出る */
    const confirmDialog = () => screen.getByRole('dialog', { name: '一括編集の確認' })
    const queryConfirmDialog = () => screen.queryByRole('dialog', { name: '一括編集の確認' })

    it('明細行単位のときだけ、各行にチェックボックスが出る(仕訳単位には出ない)', async () => {
      await setupLineView()
      expect(screen.getAllByRole('checkbox', { name: '借方の行を選択' })).toHaveLength(4)
      expect(screen.getAllByRole('checkbox', { name: '貸方の行を選択' })).toHaveLength(4)
      switchTo('仕訳単位')
      expect(screen.queryByRole('checkbox', { name: '借方の行を選択' })).not.toBeInTheDocument()
    })

    it('1行選ぶと一括編集バーが出て、選択件数を表示する。「選択を解除」でバーが消える', async () => {
      await setupLineView()
      expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
      fireEvent.click(debitBox('ランチ'))
      expect(within(bulkBar()).getByText('1行を選択中(借方 1行・貸方 0行、1件の仕訳)')).toBeInTheDocument()
      fireEvent.click(within(bulkBar()).getByRole('button', { name: '選択を解除' }))
      expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
      expect(debitBox('ランチ')).not.toBeChecked()
    })

    /** 計画Issue #266: バーの領域を常に確保し、最初のチェックでバーが出ても下の行が押し下げられないようにする */
    describe('バーの領域の確保と上部への固定(計画Issue #266)', () => {
      const slot = () => screen.getByTestId('journal-bulk-slot')

      it('未選択のときも、バーの領域(案内)が表の上に確保されている', async () => {
        await setupLineView()
        expect(within(slot()).getByText(/行にチェックを付けると、ここに一括編集が出ます/)).toBeInTheDocument()
        expect(slot().nextElementSibling).toBe(lineTable().closest('.journal-line-table-wrap'))
      })

      it('最初のチェックを付けると、同じ領域の中身がバーに替わり、領域の位置は動かない(行が押し下げられない)', async () => {
        await setupLineView()
        const before = slot()
        fireEvent.click(debitBox('ランチ'))
        expect(screen.getByTestId('journal-bulk-slot')).toBe(before)
        expect(within(before).getByRole('region', { name: '一括編集' })).toBeInTheDocument()
        expect(within(before).queryByText(/行にチェックを付けると/)).not.toBeInTheDocument()
        expect(before.nextElementSibling).toBe(lineTable().closest('.journal-line-table-wrap'))
      })

      it('選択を解除すると、領域は残り、中身が案内に戻る', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(within(bulkBar()).getByRole('button', { name: '選択を解除' }))
        expect(within(slot()).getByText(/行にチェックを付けると/)).toBeInTheDocument()
      })

      it('仕訳単位の表示や、下書き・承認待ちのタブには、バーの領域を出さない', async () => {
        await setupLineView()
        switchTo('仕訳単位')
        expect(screen.queryByTestId('journal-bulk-slot')).not.toBeInTheDocument()
      })

      it('タブの行と絞り込み欄は、ひとつの固定の容器にまとまっている(絞り込み欄を開いても同じ容器)', async () => {
        await setupLineView()
        const sticky = screen.getByRole('tablist', { name: '仕訳の種類' }).closest('.journal-screen__sticky')
        expect(sticky).not.toBeNull()
        fireEvent.click(screen.getByRole('button', { name: '絞り込みを開く' }))
        expect(within(sticky as HTMLElement).getByRole('search', { name: '仕訳の絞り込み' })).toBeInTheDocument()
      })
    })

    it('行を押さずにチェックだけでは、その仕訳の編集は始まらない', async () => {
      await setupLineView()
      fireEvent.click(debitBox('ランチ'))
      expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument()
    })

    it('各側の見出しのチェックで、その側の表示中の行をすべて選べ、もう一度押すと外れる', async () => {
      await setupLineView()
      fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
      expect(within(bulkBar()).getByText('4行を選択中(借方 4行・貸方 0行、4件の仕訳)')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
      expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
    })

    /**
     * 選択中の行クリック(計画Issue #235 C): 1行でも選んでいる間は、行のどこを押してもチェックの操作になり、
     * その仕訳の編集には入らない。チェックボックスだけを狙って押さなくてよい。
     */
    describe('選択中の行クリック', () => {
      /** 行の中のセル(0始まり): 日付・出どころ・摘要・コメント → 借方の選択・科目…(4〜9) → 貸方の選択・科目…(10〜) */
      const cell = (memo: string, index: number) => within(rowOf(memo)).getAllByRole('cell')[index]
      const DEBIT_ACCOUNT = 5

      it('選択がないときは、従来どおり行を押すとその仕訳の編集に入る', async () => {
        await setupLineView()
        fireEvent.click(cell('家賃', DEBIT_ACCOUNT))
        expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
      })

      it('選択中に別の仕訳の借方側を押すと、編集には入らず、その借方の行のチェックが入る', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(cell('家賃', DEBIT_ACCOUNT))
        expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument()
        expect(debitBox('家賃')).toBeChecked()
        expect(creditBox('家賃')).not.toBeChecked()
        expect(within(bulkBar()).getByText('2行を選択中(借方 2行・貸方 0行、2件の仕訳)')).toBeInTheDocument()
      })

      it('選択済みの行をもう一度押すと、チェックが外れる', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(debitBox('家賃'))
        fireEvent.click(cell('家賃', DEBIT_ACCOUNT))
        expect(debitBox('家賃')).not.toBeChecked()
        expect(within(bulkBar()).getByText('1行を選択中(借方 1行・貸方 0行、1件の仕訳)')).toBeInTheDocument()
      })

      it('選択中に摘要(左側)を押すと、その仕訳の全明細行が選ばれ、もう一度押すと全行が外れる', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(screen.getByRole('button', { name: '家賃' }))
        expect(screen.queryByLabelText('摘要')).not.toBeInTheDocument()
        expect(debitBox('家賃')).toBeChecked()
        expect(creditBox('家賃')).toBeChecked()
        expect(within(bulkBar()).getByText('3行を選択中(借方 2行・貸方 1行、2件の仕訳)')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: '家賃' }))
        expect(debitBox('家賃')).not.toBeChecked()
        expect(creditBox('家賃')).not.toBeChecked()
        expect(within(bulkBar()).getByText('1行を選択中(借方 1行・貸方 0行、1件の仕訳)')).toBeInTheDocument()
      })

      it('一部の行だけ選ばれている仕訳の左側を押すと、残りの行も選ばれる', async () => {
        await setupLineView()
        fireEvent.click(debitBox('家賃'))
        fireEvent.click(screen.getByRole('button', { name: '家賃' }))
        expect(creditBox('家賃')).toBeChecked()
        expect(debitBox('家賃')).toBeChecked()
      })

      it('Shift+クリックで、借方の先頭の行から末尾の行までを範囲選択でき、貸方の行は含まれない(計画Issue #235 D)', async () => {
        await setupLineView()
        const boxes = () => screen.getAllByRole('checkbox', { name: '借方の行を選択' })
        fireEvent.click(boxes()[0])
        fireEvent.click(boxes()[3], { shiftKey: true })
        expect(within(bulkBar()).getByText('4行を選択中(借方 4行・貸方 0行、4件の仕訳)')).toBeInTheDocument()
      })

      it('Ctrl+クリックで、離れた行を選択に加えられ、範囲選択のあとに1行だけ外せる', async () => {
        await setupLineView()
        const boxes = () => screen.getAllByRole('checkbox', { name: '借方の行を選択' })
        fireEvent.click(boxes()[0])
        fireEvent.click(boxes()[2], { ctrlKey: true })
        expect(within(bulkBar()).getByText('2行を選択中(借方 2行・貸方 0行、2件の仕訳)')).toBeInTheDocument()
        // Ctrl+クリックで押した3行目が基点になるので、Shift+クリックの範囲は3行目〜4行目
        fireEvent.click(boxes()[3], { shiftKey: true })
        expect(within(bulkBar()).getByText('3行を選択中(借方 3行・貸方 0行、3件の仕訳)')).toBeInTheDocument()
        fireEvent.click(boxes()[2], { ctrlKey: true })
        expect(within(bulkBar()).getByText('2行を選択中(借方 2行・貸方 0行、2件の仕訳)')).toBeInTheDocument()
      })

      it('最後の1行を行の押下で外して選択が空になると、次に行を押したときは編集に入る', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(cell('ランチ', DEBIT_ACCOUNT))
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
        fireEvent.click(cell('家賃', DEBIT_ACCOUNT))
        expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
      })
    })

    /**
     * 選択の解除の導線(計画Issue #235 C): 選択中は行を押しても編集に入れないため、Esc でも全解除できる。
     * 入力中・選択欄のダイアログ操作中の Esc は、その操作に任せて選択を解除しない。
     */
    describe('Esc での選択の全解除', () => {
      it('選択中に Esc を押すと、選択がすべて解除され、一括編集バーが消える', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(creditBox('家賃'))
        fireEvent.keyDown(document.body, { key: 'Escape' })
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
        expect(debitBox('ランチ')).not.toBeChecked()
        expect(creditBox('家賃')).not.toBeChecked()
      })

      it('解除したあとは、行を押すと従来どおり編集に入る', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.keyDown(document.body, { key: 'Escape' })
        fireEvent.click(screen.getByRole('button', { name: '家賃' }))
        expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
      })

      it('テキスト入力欄にフォーカスがあるときの Esc では、選択を解除しない', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.keyDown(memoSearch(), { key: 'Escape' })
        expect(bulkBar()).toBeInTheDocument()
        expect(debitBox('ランチ')).toBeChecked()
      })

      it('一括編集の選択欄のダイアログを開いている間の Esc では、選択を解除しない', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(within(bulkBar()).getByRole('button', { name: '一括編集の科目: 変更しない' }))
        fireEvent.keyDown(screen.getByRole('dialog', { name: '一括編集の科目' }), { key: 'Escape' })
        expect(bulkBar()).toBeInTheDocument()
        expect(debitBox('ランチ')).toBeChecked()
      })

      it('Esc 以外のキーでは解除しない', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.keyDown(document.body, { key: 'a' })
        expect(bulkBar()).toBeInTheDocument()
      })

      it('チェックボックスにフォーカスがある状態(チェックを押した直後)でも、Esc で選択が解除される', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        debitBox('ランチ').focus()
        fireEvent.keyDown(debitBox('ランチ'), { key: 'Escape' })
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
      })

      it('一括編集バーに、Esc でも解除できることを案内する', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        expect(within(bulkBar()).getByText(/Esc/)).toBeInTheDocument()
        expect(within(bulkBar()).getByText(/行を押してもチェックを切り替えられます/)).toBeInTheDocument()
      })
    })

    describe('選べない項目の先回りの無効化', () => {
      it('食費(費用)の行だけを選ぶと精算バッチは選べず、立替金の行だけを選ぶと精算バッチを選べる', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        openMore()
        expect(findBatchButton('一括編集の精算バッチ', within(bulkBar()))).toBeDisabled()
        expect(within(bulkBar()).getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeEnabled()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(debitBox('旅行の立替'))
        openMore()
        expect(findBatchButton('一括編集の精算バッチ', within(bulkBar()))).toBeEnabled()
        expect(within(bulkBar()).getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
      })

      it('普通預金(資産)の行が混ざると取引先は選べない', async () => {
        await setupLineView()
        fireEvent.click(creditBox('ランチ'))
        expect(within(bulkBar()).getByRole('button', { name: '一括編集の取引先: 変更しない' })).toBeDisabled()
        expect(within(bulkBar()).getByText('費用・収益の行のみ')).toBeInTheDocument()
      })
    })

    describe('適用', () => {
      it('2回押して確定し、仕訳ごとに1件ずつ更新する。選択した行だけが変わり、保存後は選択が解除されて結果が出る', async () => {
        const props = await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(debitBox('家賃'))
        openMore()
        chooseMember('一括編集の世帯メンバー', '妻', within(bulkBar()))

        fireEvent.click(apply())
        expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
        expect(confirmDialog()).toHaveTextContent('2行(2件の仕訳)を更新します。元に戻せません。')
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: '本当に更新する' }))

        await waitFor(() => expect(props.journalEntryRepository.update).toHaveBeenCalledTimes(2))
        const calls = props.journalEntryRepository.update.mock.calls as unknown as [number, { lines: { id?: number; householdMemberId: number }[] }][]
        expect(calls.map(([id]) => id)).toEqual([1, 2])
        // ランチの借方(行11)だけが妻(2)になり、貸方(行12)は夫(1)のまま
        expect(calls[0][1].lines.map((l) => [l.id, l.householdMemberId])).toEqual([
          [11, 2],
          [12, 1],
        ])
        expect(await screen.findByText('2行(2件の仕訳)を更新しました')).toBeInTheDocument()
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
      })

      it('1回目のあとに「やめる」を押すと何も更新されず、項目を選び直しても確認は取り消される', async () => {
        const props = await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        openMore()
        chooseMember('一括編集の世帯メンバー', '妻', within(bulkBar()))
        fireEvent.click(apply())
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'やめる' }))
        expect(queryConfirmDialog()).not.toBeInTheDocument()
        fireEvent.click(apply())
        chooseMember('一括編集の世帯メンバー', '夫', within(bulkBar()))
        expect(queryConfirmDialog()).not.toBeInTheDocument()
        expect(props.journalEntryRepository.update).not.toHaveBeenCalled()
      })

      it('科目を一括で変えると、選んだ行の科目が変わる', async () => {
        const props = await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        chooseAccount('家賃')
        fireEvent.click(apply())
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: '本当に更新する' }))
        await waitFor(() => expect(props.journalEntryRepository.update).toHaveBeenCalledTimes(1))
        const [id, input] = props.journalEntryRepository.update.mock.calls[0] as unknown as [number, { lines: { accountId: number }[] }]
        expect(id).toBe(1)
        expect(input.lines.map((l) => l.accountId)).toEqual([4, 2])
      })

      it('一部の仕訳で保存に失敗したら、成功した分を報告し、失敗した仕訳と理由を示して、その仕訳の行は選択したままにする', async () => {
        const props = await setupLineView()
        // ランチ(先)が失敗し、家賃(後)は成功する
        props.journalEntryRepository.update.mockRejectedValueOnce(new Error('boom'))
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(debitBox('家賃'))
        openMore()
        chooseMember('一括編集の世帯メンバー', '妻', within(bulkBar()))
        fireEvent.click(apply())
        fireEvent.click(within(confirmDialog()).getByRole('button', { name: '本当に更新する' }))

        expect(await screen.findByText('1行(1件の仕訳)を更新しました')).toBeInTheDocument()
        expect(screen.getByRole('alert')).toHaveTextContent(/更新できませんでした.*「ランチ」/)
        // 失敗したランチの行は選択したまま。成功した家賃の行は外れる
        expect(within(bulkBar()).getByText('1行を選択中(借方 1行・貸方 0行、1件の仕訳)')).toBeInTheDocument()
        expect(debitBox('ランチ')).toBeChecked()
        expect(debitBox('家賃')).not.toBeChecked()
      })
    })

    describe('他の操作との整合', () => {
      it('選択を解除してから行を押してインライン編集を始めると、チェックは押せなくなる(選択中の行の押下は編集に入らない、計画Issue #235 C)', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(within(bulkBar()).getByRole('button', { name: '選択を解除' }))
        fireEvent.click(screen.getByRole('button', { name: '家賃' }))
        expect(screen.getByLabelText('摘要')).toHaveValue('家賃')
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
        for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled()
      })

      it('絞り込みで見えなくなった行は、選択に含まれない(表示中の行だけが対象)', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(debitBox('家賃'))
        expect(within(bulkBar()).getByText(/^2行を選択中/)).toBeInTheDocument()
        fireEvent.change(memoSearch(), { target: { value: '家賃' } })
        expect(within(bulkBar()).getByText('1行を選択中(借方 1行・貸方 0行、1件の仕訳)')).toBeInTheDocument()
      })

      it('表示方式を切り替えると、一括編集の選択は解除される', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        switchTo('仕訳単位')
        switchTo('明細行単位')
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
        expect(debitBox('ランチ')).not.toBeChecked()
      })

      it('タブを切り替えると、一括編集の選択は解除される', async () => {
        await setupLineView()
        fireEvent.click(debitBox('ランチ'))
        fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
        fireEvent.click(screen.getByRole('tab', { name: /仕訳一覧/ }))
        await screen.findByRole('table', { name: '仕訳の明細行' })
        expect(screen.queryByRole('region', { name: '一括編集' })).not.toBeInTheDocument()
      })
    })
  })
})

describe('JournalScreen: テンプレートから起票(計画Issue #201)', () => {
  const template = (overrides: Partial<JournalTemplate> = {}): JournalTemplate => ({
    id: 1,
    name: 'コンビニ(昼食)',
    memo: '昼食',
    bookkeeperHouseholdMemberId: 2,
    groupId: null,
    sortOrder: 0,
    isActive: true,
    lines: [
      { lineNo: 1, side: 'debit', accountId: 1, amount: null, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
      { lineNo: 2, side: 'credit', accountId: 2, amount: null, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
    ],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  })
  const pickerButton = () => screen.getByRole('button', { name: 'テンプレートから起票' })
  /** ボタンを押してダイアログを開く(開く直前にテンプレートを読み直すため、表示を待つ) */
  const openPicker = async () => {
    fireEvent.click(pickerButton())
    return screen.findByRole('dialog', { name: 'テンプレートから起票' })
  }
  /** ダイアログを開いて、名前のテンプレートで起票する */
  const startFrom = async (name: string) => {
    const dialog = await openPicker()
    fireEvent.doubleClick(within(dialog).getByRole('option', { name: new RegExp(name) }))
  }

  it('テンプレートの機能(リポジトリ)を渡さないときは、ボタンもタブも出ない', async () => {
    setup()
    await ready()

    expect(screen.queryByRole('button', { name: 'テンプレートから起票' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'テンプレート' })).not.toBeInTheDocument()
  })

  it('templatesPanelを渡すと「テンプレート」タブが出て、押すとその内容が表示される', async () => {
    setup({ templates: [], templatesPanel: <p>テンプレート管理の中身</p> })
    await ready()

    fireEvent.click(screen.getByRole('tab', { name: 'テンプレート' }))

    expect(await screen.findByText('テンプレート管理の中身')).toBeInTheDocument()
  })

  it('「テンプレートから起票」を押すとダイアログが開き、有効なテンプレートが一覧に出る', async () => {
    setup({ templates: [template(), template({ id: 2, name: '無効なもの', isActive: false })] })
    await ready()

    const dialog = await openPicker()

    expect(within(dialog).getByRole('option', { name: /コンビニ\(昼食\)/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: /無効なもの/ })).not.toBeInTheDocument()
  })

  it('画面を開いた後に追加・変更されたテンプレートも、ボタンを押した時点の最新の内容で一覧に出る(「テンプレート」タブでの追加直後など)', async () => {
    const templates: JournalTemplate[] = []
    setup({ templates })
    await ready()

    // 画面を開いたあと(別のタブでの操作など)にテンプレートが追加された
    templates.push(template({ name: '後から追加した' }))
    const dialog = await openPicker()

    expect(within(dialog).getByRole('option', { name: /後から追加した/ })).toBeInTheDocument()
  })

  it('テンプレートを選ぶと、「新しい仕訳」にテンプレートの内容(日付は今日・摘要・起票者・科目)が入り、案内が出る', async () => {
    setup({ templates: [template()] })
    await ready()

    await startFrom('コンビニ')

    expect(screen.queryByRole('dialog', { name: 'テンプレートから起票' })).not.toBeInTheDocument()
    expect(within(detail()).getByRole('heading', { name: '新しい仕訳' })).toBeInTheDocument()
    expect(within(detail()).getByLabelText('取引日')).toHaveValue(new Date().toISOString().slice(0, 10))
    expect(memoInput()).toHaveValue('昼食')
    expectMember('起票者', '妻', within(detail()))
    expect(within(detail()).getByRole('button', { name: /^科目: 食費/ })).toBeInTheDocument()
    expect(within(detail()).getByRole('button', { name: /^科目: 普通預金/ })).toBeInTheDocument()
    expect(within(detail()).getByText('テンプレート「コンビニ(昼食)」の内容を入れました。金額を入力してください。')).toBeInTheDocument()
  })

  it('金額を入れて「保存」すると、テンプレートの内容で仕訳が作られる', async () => {
    const props = setup({ templates: [template()] })
    await ready()
    await startFrom('コンビニ')

    fireEvent.change(within(detail()).getByLabelText('食費の金額'), { target: { value: '650' } })
    fireEvent.change(within(detail()).getByLabelText('普通預金の金額'), { target: { value: '650' } })
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(props.journalEntryRepository.create).toHaveBeenCalledTimes(1))
    expect(props.journalEntryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        memo: '昼食',
        householdMemberId: 2,
        lines: [
          expect.objectContaining({ side: 'debit', accountId: 1, amount: 650 }),
          expect.objectContaining({ side: 'credit', accountId: 2, amount: 650 }),
        ],
      }),
    )
  })

  it('テンプレートで固定の金額は、そのまま入る', async () => {
    setup({
      templates: [
        template({
          name: 'ジム',
          lines: [
            { lineNo: 1, side: 'debit', accountId: 1, amount: 8800, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
            { lineNo: 2, side: 'credit', accountId: 2, amount: 8800, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
          ],
        }),
      ],
    })
    await ready()

    await startFrom('ジム')

    expect(within(detail()).getByLabelText('食費の金額')).toHaveValue('8800')
    expect(within(detail()).getByText('貸借一致')).toBeInTheDocument()
  })

  it('無効な科目があるテンプレートは、その行の科目を空にして警告を出し、保存できない', async () => {
    const props = setup({
      templates: [
        template({
          lines: [
            { lineNo: 1, side: 'debit', accountId: 99, amount: 500, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
            { lineNo: 2, side: 'credit', accountId: 2, amount: 500, projectId: null, householdMemberId: null, counterpartyId: null, settlementBatchId: null },
          ],
        }),
      ],
    })
    await ready()

    await startFrom('コンビニ')

    expect(within(detail()).getByText('1行目の科目「不明な科目」は使えないため、選び直してください')).toBeInTheDocument()
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(within(detail()).getByRole('alert')).toBeInTheDocument())
    expect(props.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('入力途中の内容があるときは、ボタンを押すと未保存の確認が出て、破棄するとダイアログが開く', async () => {
    setup({ templates: [template()] })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: '手入力で起票' }))
    editMemo('入力途中')

    fireEvent.click(pickerButton())

    expect(leaveDialog()).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'テンプレートから起票' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))
    expect(await screen.findByRole('dialog', { name: 'テンプレートから起票' })).toBeInTheDocument()
  })

  it('キャンセルすると、何も変わらずダイアログが閉じる', async () => {
    setup({ templates: [template()] })
    await ready()

    const dialog = await openPicker()
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('dialog', { name: 'テンプレートから起票' })).not.toBeInTheDocument()
    expect(within(detail()).queryByRole('heading', { name: '新しい仕訳' })).not.toBeInTheDocument()
  })
})

describe('JournalScreen: 明細から起票(計画Issue #214・#231)', () => {
  it('呼び出し側が明細取込への遷移を渡さないときは、「明細から起票」を出さない', async () => {
    setup()
    await ready()

    expect(screen.queryByRole('button', { name: '明細から起票' })).not.toBeInTheDocument()
  })

  it('右側の起票のボタンの並びに「明細から起票」が出る。ここではCSVを選ばず(ファイル選択の入力欄は持たない)、明細取込画面で選ぶ', async () => {
    setup({ onStartStatementImport: vi.fn() })
    await ready()

    expect(screen.getByRole('button', { name: '明細から起票' })).toBeInTheDocument()
    expect(screen.queryByLabelText('明細のCSVを選択')).not.toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('押すと、明細取込画面へ移るコールバックが1回呼ばれる(明細取込画面の開始状態から、CSVの選択や一時保存の再開ができる)', async () => {
    const onStart = vi.fn()
    setup({ onStartStatementImport: onStart })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '明細から起票' }))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(leaveDialog()).not.toBeInTheDocument()
  })

  it('編集中に押すと、移動の前に未保存の警告が出る。キャンセルすれば移らず、編集中の内容は残る', async () => {
    const onStart = vi.fn()
    setup({ onStartStatementImport: onStart })
    await ready()
    editMemo('ランチ(修正中)')

    fireEvent.click(screen.getByRole('button', { name: '明細から起票' }))
    expect(leaveDialog()).toBeInTheDocument()
    expect(onStart).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onStart).not.toHaveBeenCalled()
    expect(memoInput()).toHaveValue('ランチ(修正中)')
  })

  it('編集中に押して「破棄して移動」を選ぶと、明細取込画面へ移る', async () => {
    const onStart = vi.fn()
    setup({ onStartStatementImport: onStart })
    await ready()
    editMemo('ランチ(修正中)')

    fireEvent.click(screen.getByRole('button', { name: '明細から起票' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄して移動' }))

    expect(onStart).toHaveBeenCalledTimes(1)
  })
})

describe('JournalScreen: 起票の入口のボタン(計画Issue #214)', () => {
  it('「明細から起票」「テンプレートから起票」「手入力で起票」は、同じ見た目(強調なし)で並ぶ', async () => {
    setup({ onStartStatementImport: vi.fn(), templates: [] })
    await ready()

    const names = ['明細から起票', 'テンプレートから起票', '手入力で起票']
    const buttons = names.map((name) => screen.getByRole('button', { name }))

    expect(buttons.map((b) => b.className)).toEqual(Array(3).fill('journal-screen__button'))
    // 同じ枠の中に、この順で並ぶ
    expect(new Set(buttons.map((b) => b.parentElement)).size).toBe(1)
    expect(Array.from(buttons[0].parentElement!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(names)
  })
})

/** 新しい順に id=1..count の仕訳(摘要は「仕訳{id}」)。分割表示(計画Issue #253)のテスト用 */
function makeManyEntries(count: number): JournalEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1
    // 日付は id が大きいほど古い(一覧は新しい順なので、並びは id の昇順になる)
    const date = new Date(Date.UTC(2026, 9, 31) - i * 86400000).toISOString().slice(0, 10)
    return entry(id, date, `仕訳${id}`, 'manual', [line(id * 10 + 1, id, 'debit', 1, 1000), line(id * 10 + 2, id, 'credit', 2, 1000)])
  })
}

describe('JournalScreen: 仕訳一覧の分割表示(計画Issue #253)', () => {
  // 1ページ分の件数は仕訳単位・明細行単位ごとの定数。値を変えてもテストが崩れないよう、定数から組み立てる
  const PAGE = JOURNAL_LIST_PAGE_SIZE.entry
  const LINE_PAGE = JOURNAL_LIST_PAGE_SIZE.line
  const listed = (id: number) => screen.queryByText(`仕訳${id}`)

  it('全体が1ページ分を超えるときは、初めは1ページ分だけ描き、「N / 全体件数を表示中」と「さらに50件表示」を出す', async () => {
    setup({ entries: makeManyEntries(PAGE + 50) })
    await screen.findByText('仕訳1')
    expect(listed(PAGE)).toBeInTheDocument()
    expect(listed(PAGE + 1)).not.toBeInTheDocument()
    expect(screen.getByText(`${PAGE} / ${PAGE + 50}件を表示中`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'さらに50件表示' })).toBeInTheDocument()
  })

  it('絞り込み欄の「該当N件」は、表示中の件数ではなく、絞り込み後の全体件数を出す', async () => {
    setup({ entries: makeManyEntries(PAGE + 50) })
    await screen.findByText('仕訳1')
    memoSearch()
    expect(screen.getByText(`${PAGE + 50}件`)).toBeInTheDocument()
  })

  it('「さらに表示」を押すと残りが表示され、全件を表示済みになるとボタンも件数も消える', async () => {
    setup({ entries: makeManyEntries(PAGE + 50) })
    await screen.findByText('仕訳1')
    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    expect(listed(PAGE + 50)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /さらに/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/件を表示中/)).not.toBeInTheDocument()
  })

  it('全体が1ページ分に収まるときは、ボタンも件数も出さない', async () => {
    setup({ entries: makeManyEntries(PAGE - 50) })
    await screen.findByText('仕訳1')
    expect(listed(PAGE - 50)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /さらに/ })).not.toBeInTheDocument()
  })

  it('絞り込み条件を変えると、増やした表示件数は先頭の1ページ分に戻る', async () => {
    setup({ entries: makeManyEntries(PAGE + 50) })
    await screen.findByText('仕訳1')
    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    expect(listed(PAGE + 50)).toBeInTheDocument()
    fireEvent.change(memoSearch(), { target: { value: '仕訳' } })
    expect(listed(PAGE)).toBeInTheDocument()
    expect(listed(PAGE + 1)).not.toBeInTheDocument()
    expect(screen.getByText(`${PAGE} / ${PAGE + 50}件を表示中`)).toBeInTheDocument()
  })

  it('選択中の仕訳が表示範囲の外になるときは、その仕訳が見える最小のページ分まで表示を広げる', async () => {
    const total = PAGE * 2 + 50
    setup({ entries: makeManyEntries(total) })
    await screen.findByText('仕訳1')
    fireEvent.click(screen.getByRole('button', { name: `さらに${PAGE}件表示` }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`仕訳${PAGE + 30}`) }))
    // 絞り込みを変えると先頭に戻るが、選択中の仕訳(2ページ目)は見えたままにする
    fireEvent.change(memoSearch(), { target: { value: '仕訳' } })
    expect(listed(PAGE + 30)).toBeInTheDocument()
    expect(listed(PAGE * 2)).toBeInTheDocument()
    expect(listed(PAGE * 2 + 1)).not.toBeInTheDocument()
    expect(screen.getByText(`${PAGE * 2} / ${total}件を表示中`)).toBeInTheDocument()
  })

  it('明細行単位でも、初めは1ページ分の仕訳だけを描き、「さらに表示」で増やせる', async () => {
    localStorage.setItem('localbudget:journal-view-mode', 'line')
    setup({ entries: makeManyEntries(LINE_PAGE + 50) })
    await screen.findByText(`${LINE_PAGE} / ${LINE_PAGE + 50}件を表示中`)
    // 表は1仕訳につき1行(借方・貸方を横に並べる)。見出し行などは数えず、増えた行数で確かめる
    const before = screen.getAllByRole('row').length
    expect(screen.queryByText(`仕訳${LINE_PAGE + 1}`)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
    expect(screen.getAllByRole('row').length - before).toBe(50)
  })

  it('明細行単位の見出しのチェック(借方・貸方)は、表示中の行だけを選ぶ', async () => {
    localStorage.setItem('localbudget:journal-view-mode', 'line')
    setup({ entries: makeManyEntries(LINE_PAGE + 50) })
    await screen.findByText(`${LINE_PAGE} / ${LINE_PAGE + 50}件を表示中`)
    fireEvent.click(screen.getByRole('checkbox', { name: '借方の行をすべて選択' }))
    expect(screen.getByText(new RegExp(`${LINE_PAGE}行を選択中`))).toBeInTheDocument()
  })

  it('表示中の最後の仕訳を削除すると、まだ表示していない仕訳へは飛ばず、表示中の直前の仕訳を選ぶ', async () => {
    const props = setup({ entries: makeManyEntries(PAGE + 50) })
    await screen.findByText('仕訳1')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`仕訳${PAGE}(?!\\d)`) }))
    fireEvent.click(within(detail()).getByRole('button', { name: 'この仕訳を削除' }))
    fireEvent.click(within(detail()).getByRole('button', { name: '本当に削除する' }))
    await waitFor(() => expect(props.journalEntryRepository.delete).toHaveBeenCalledWith(PAGE))
    await waitFor(() => expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue(`仕訳${PAGE - 1}`))
  })

  describe('明細行単位で「さらに表示」した後の一括編集の選択', () => {
    const debitBoxes = () => screen.getAllByRole('checkbox', { name: '借方の行を選択' })
    const selectedCount = (n: number) => screen.queryByText(new RegExp(`(^|\\D)${n}行を選択中`))

    async function openSecondPage() {
      localStorage.setItem('localbudget:journal-view-mode', 'line')
      setup({ entries: makeManyEntries(LINE_PAGE + 50) })
      await screen.findByText(`${LINE_PAGE} / ${LINE_PAGE + 50}件を表示中`)
      fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
      expect(debitBoxes()).toHaveLength(LINE_PAGE + 50)
    }

    it('2ページ目の行をチェックし、Shift+クリックで範囲選択でき、1ページ目の行は選ばれない', async () => {
      await openSecondPage()
      fireEvent.click(debitBoxes()[LINE_PAGE + 9])
      expect(selectedCount(1)).toBeInTheDocument()
      fireEvent.click(debitBoxes()[LINE_PAGE + 12], { shiftKey: true })
      expect(selectedCount(4)).toBeInTheDocument()
      expect(debitBoxes()[0]).not.toBeChecked()
      expect(debitBoxes()[LINE_PAGE + 10]).toBeChecked()
    })

    it('選択中に、2ページ目の行の左側(摘要など)を押すと、その仕訳の行のチェックを切り替える', async () => {
      await openSecondPage()
      fireEvent.click(debitBoxes()[LINE_PAGE + 9])
      const row = screen.getByText(`仕訳${LINE_PAGE + 20}`).closest('tr')!
      fireEvent.click(within(row).getByText(`仕訳${LINE_PAGE + 20}`))
      // 最初に選んだ1行 + 押した仕訳の借方・貸方の2行
      expect(selectedCount(3)).toBeInTheDocument()
      expect(within(row).getByRole('checkbox', { name: '借方の行を選択' })).toBeChecked()
      expect(within(row).getByRole('checkbox', { name: '貸方の行を選択' })).toBeChecked()
    })

    it('絞り込み条件を変えて表示から外れた行のチェックは外れ、「さらに表示」で再び見えてもチェックは戻らない', async () => {
      await openSecondPage()
      fireEvent.click(debitBoxes()[LINE_PAGE + 5])
      expect(selectedCount(1)).toBeInTheDocument()
      fireEvent.change(memoSearch(), { target: { value: '仕訳' } })
      fireEvent.click(screen.getByRole('button', { name: 'さらに50件表示' }))
      expect(debitBoxes()[LINE_PAGE + 5]).not.toBeChecked()
      expect(screen.queryByText(/行を選択中/)).not.toBeInTheDocument()
    })

    it('絞り込み後も表示中の行のチェックは保たれる', async () => {
      await openSecondPage()
      fireEvent.click(debitBoxes()[2])
      fireEvent.change(memoSearch(), { target: { value: '仕訳' } })
      expect(debitBoxes()[2]).toBeChecked()
      expect(selectedCount(1)).toBeInTheDocument()
    })
  })
})
