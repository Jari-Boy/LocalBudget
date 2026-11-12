// @vitest-environment jsdom
/**
 * 仕訳画面(JournalScreen、計画Issue #152)のコンポーネントテスト。
 * 絞り込み・結果一覧・詳細が画面遷移なしで切り替わること、保存で精算バッチのタグとコメントが
 * 保持されること、貸借が合わないと保存されないこと、精算バッチを付けられない科目で拒否されたときの
 * 表示(計画Issue #167)、確定済みの仕訳の削除(2回押し・影響の表示・
 * 次の行の選択)、割勘できない理由の表示、下書き(保存・確定・削除)、定期取引の提案
 * (金額修正して確定・見送り・古い提案が残っていると処理できない)、関連仕訳の表示を検証する。計画Issue #164で追加した、
 * 定期の確認タブの摘要・コメントの編集と保存、土日の調整後の日付と金額の初期値の表示、一覧に科目を出さないこと、
 * 複数の提案のまとめて確定(チェックの連動・すべて選択・起票者の一括指定・confirmManyの呼び出し)も検証する。
 * 外部依存はインメモリの偽Repository(vi.fn)で置き換える。
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../infrastructure/i18n/i18n'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import type { JournalEntryDraft } from '../../domain/journal/JournalEntryDraft'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { UnsavedChangesGuardProvider, useUnsavedChangesGuard } from '../common/unsaved-changes/unsavedChangesGuard'
import { JournalScreen, type JournalScreenProps } from './JournalScreen'
import type { RecurringTransactionRuleLine } from '../../domain/recurring-transaction/RecurringTransactionRule'

afterEach(cleanup)

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
    isActive: true,
    isSystemManaged: false,
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
  overrides: Partial<{ entries: JournalEntry[]; drafts: JournalEntryDraft[]; initialFilter: JournalEntryFilter }> = {},
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
    counterpartyRepository: { findAll: vi.fn(async () => []), create: vi.fn() },
    counterpartyGroupRepository: { findAll: vi.fn(async () => []) },
    projectRepository: { findAll: vi.fn(async () => []) },
    projectGroupRepository: { findAll: vi.fn(async () => []) },
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
    },
    onSplit: vi.fn(),
    onProposalsChanged: vi.fn(),
    initialFilter: overrides.initialFilter,
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

describe('JournalScreen', () => {
  it('initialFilterを渡すと、その条件で絞り込んだ状態で開く(分析画面から期間・条件を引き継ぐため、計画Issue #155)', async () => {
    setup({ initialFilter: { dateFrom: '2026-10-01', dateTo: '2026-10-04', accountIds: [4] } })
    await screen.findByRole('heading', { name: '仕訳', level: 1 })
    expect(await screen.findByText('家賃', { selector: '.journal-result-list__memo' })).toBeInTheDocument()
    expect(screen.queryByText('ランチ')).not.toBeInTheDocument()
    expect(screen.getByText('1件')).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('摘要で検索'), { target: { value: '家賃' } })
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

  it('精算バッチを付けられない科目だとRepositoryに拒否されたら、立替金・未払金のままにするよう表示する(計画Issue #167)', async () => {
    const props = setup()
    await ready()
    props.journalEntryRepository.update.mockRejectedValueOnce(new SettlementBatchOnNonAdvanceAccountError(1))
    fireEvent.click(within(detail()).getByRole('button', { name: '保存' }))
    expect(await within(detail()).findByText('精算バッチのタグが付いた明細の科目は、立替金・未払金のままにしてください。')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '新規仕訳' }))
    expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('')
    expect(within(detail()).getByRole('heading', { name: '新しい仕訳' })).toBeInTheDocument()
    // 科目を選ばずに保存しようとしても作成されない
    fireEvent.click(within(detail()).getByRole('button', { name: '保存して続けて入力' }))
    expect(props.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('既存の仕訳の編集には「保存して続けて入力」を出さない(新規仕訳にだけ出す)', async () => {
    setup()
    await ready()
    expect(within(detail()).queryByRole('button', { name: '保存して続けて入力' })).not.toBeInTheDocument()
    expect(within(detail()).getByRole('button', { name: '保存' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新規仕訳' }))
    expect(within(detail()).getByRole('button', { name: '保存して続けて入力' })).toBeInTheDocument()
  })

  describe('起票者と明細行の世帯メンバー(計画Issue #169)', () => {
    it('起票者を変えて保存すると、更新に起票者が渡り、手で変えていない明細行も追従する', async () => {
      const props = setup()
      await ready()
      fireEvent.change(within(detail()).getByRole('combobox', { name: '起票者' }), { target: { value: '2' } })
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
      fireEvent.click(screen.getByRole('button', { name: '新規仕訳' }))

      const memberSelects = within(detail()).getAllByRole('combobox', { name: '世帯メンバー' })
      expect(memberSelects).toHaveLength(2)
      for (const select of memberSelects) expect(select).toHaveValue('1')
    })

    it('世帯メンバーが入っていない下書きの行は、再開すると起票者で補われて確定できる', async () => {
      setup({ drafts: [balancedDraft(101, '確定する下書き')] })
      await ready()
      fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
      fireEvent.click(await screen.findByRole('button', { name: /確定する下書き/ }))

      for (const select of within(detail()).getAllByRole('combobox', { name: '世帯メンバー' })) {
        expect(select).toHaveValue('1')
      }
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

    it('「保存して移動」で保存できなかったとき(科目が未選択など)は、移動せず編集中の内容と理由を残す', async () => {
      const props = setup()
      await ready()
      fireEvent.click(screen.getByRole('button', { name: '新規仕訳' }))
      editMemo('書きかけ')
      fireEvent.click(screen.getByRole('button', { name: /家賃/ }))
      fireEvent.click(screen.getByRole('button', { name: '保存して移動' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('保存できません')
      expect(props.journalEntryRepository.create).not.toHaveBeenCalled()
      expect(within(detail()).getByRole('heading', { name: '新しい仕訳' })).toBeInTheDocument()
      expect(memoInput()).toHaveValue('書きかけ')
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

    it('編集してから「新規仕訳」を押すときも確認する', async () => {
      setup()
      await ready()
      editMemo('ランチ(修正中)')
      fireEvent.click(screen.getByRole('button', { name: '新規仕訳' }))
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

  it('下書きを削除できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /下書き/ }))
    fireEvent.click(await screen.findByRole('button', { name: /書きかけ/ }))
    fireEvent.click(within(detail()).getByRole('button', { name: '削除' }))
    await waitFor(() => expect(props.journalEntryDraftRepository.delete).toHaveBeenCalledWith(100))
  })

  it('定期の確認タブでは古い順に並び、先頭の提案を金額修正して確定できる', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /定期の確認/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    expect(rows[0]).toHaveTextContent('2026')
    fireEvent.click(rows[0])
    fireEvent.change(within(detail()).getByLabelText('家賃の金額'), { target: { value: '5500' } })
    fireEvent.click(within(detail()).getByRole('button', { name: '確定' }))
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
    fireEvent.click(screen.getByRole('tab', { name: /定期の確認/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    fireEvent.click(rows[1])
    expect(within(detail()).getByRole('button', { name: '確定' })).toBeDisabled()
    expect(within(detail()).getByRole('button', { name: '今回は見送る' })).toBeDisabled()
    expect(within(detail()).getByText('先に同じルールの古い提案を確定するか見送ってください')).toBeInTheDocument()
    expect(props.recurringTransactionProposalApi.skip).not.toHaveBeenCalled()
  })

  it('提案を見送ると skip を呼ぶ', async () => {
    const props = setup()
    await ready()
    fireEvent.click(screen.getByRole('tab', { name: /定期の確認/ }))
    const rows = await screen.findAllByRole('button', { name: /ネット代/ })
    fireEvent.click(rows[0])
    fireEvent.click(within(detail()).getByRole('button', { name: '今回は見送る' }))
    await waitFor(() =>
      expect(props.recurringTransactionProposalApi.skip).toHaveBeenCalledWith({ ruleId: 1, dueDate: '2026-10-01' }),
    )
  })

  describe('定期の確認タブ(計画Issue #164)', () => {
    async function openProposals() {
      const props = setup()
      await ready()
      fireEvent.click(screen.getByRole('tab', { name: /定期の確認/ }))
      await screen.findAllByRole('button', { name: /ネット代/ })
      return props
    }
    const checkbox = (name: RegExp) => screen.getAllByRole('checkbox', { name })

    it('一覧には科目(借方→貸方)を表示しない', async () => {
      await openProposals()

      for (const row of screen.getAllByRole('button', { name: /ネット代|ジム会費/ })) {
        expect(row).not.toHaveTextContent('→')
        expect(row).not.toHaveTextContent('家賃')
      }
    })

    it('一覧の日付は土日の調整後の日付で、ずらした提案には期日を添える', async () => {
      await openProposals()

      const adjusted = screen.getAllByRole('button', { name: /ネット代/ })[1]
      expect(adjusted).toHaveTextContent('2026/11/2')
      expect(adjusted).toHaveTextContent('期日 2026/11/1')
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
      fireEvent.click(within(detail()).getByRole('button', { name: '確定' }))

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
      expect(debitColumn.getByRole('combobox', { name: '世帯メンバー' })).toBeEnabled()
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

    it('チェックを付けても詳細の選択は変わらず、行を押しても(詳細は開くが)チェックは変わらない', async () => {
      await openProposals()

      fireEvent.click(checkbox(/ネット代/)[0])
      expect(screen.queryByRole('checkbox', { name: /ネット代/, checked: true })).toBeInTheDocument()
      fireEvent.click(screen.getAllByRole('button', { name: /ジム会費/ })[0])

      expect(within(detail()).getByLabelText('摘要(任意)')).toHaveValue('ジム会費')
      expect(checkbox(/ジム会費/)[0]).not.toBeChecked()
      expect(checkbox(/ネット代/)[0]).toBeChecked()
    })

    it('すべて選択でチェックが全件に付き、もう一度押すと全部外れる', async () => {
      await openProposals()

      fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))
      expect(screen.getByText('3件を選択中')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: 'すべて選択' }))

      expect(screen.getByText('0件を選択中')).toBeInTheDocument()
    })

    it('何もチェックしていないときは「選択した提案を確定」が押せない', async () => {
      await openProposals()

      expect(screen.getByRole('button', { name: '選択した提案を確定' })).toBeDisabled()
    })

    it('選択した提案を確定すると、選んだ提案をconfirmManyで確定する(金額は渡さず、初期値のまま)', async () => {
      const props = await openProposals()
      fireEvent.click(checkbox(/ネット代/)[1])

      fireEvent.click(screen.getByRole('button', { name: '選択した提案を確定' }))

      await waitFor(() =>
        expect(props.recurringTransactionProposalApi.confirmMany).toHaveBeenCalledWith({
          items: [
            { ruleId: 1, dueDate: '2026-10-01' },
            { ruleId: 1, dueDate: '2026-11-01' },
          ],
          householdMemberId: undefined,
        }),
      )
      expect(await screen.findByText('2件の仕訳を確定しました')).toBeInTheDocument()
    })

    it('起票者が決まっていないルールを選ぶと、まとめて起票者を選ぶまで確定できず、選ぶとその起票者で確定する', async () => {
      const props = await openProposals()
      fireEvent.click(checkbox(/ジム会費/)[0])

      const confirmButton = screen.getByRole('button', { name: '選択した提案を確定' })
      expect(confirmButton).toBeDisabled()
      expect(screen.getByText(/起票者が決まっていない提案\(ジム会費\)があります/)).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText('まとめて確定の起票者'), { target: { value: '2' } })
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

      expect(screen.queryByLabelText('まとめて確定の起票者')).not.toBeInTheDocument()
    })

    it('まとめて確定に失敗したら、エラーを表示する(確定したことにならない)', async () => {
      const props = await openProposals()
      props.recurringTransactionProposalApi.confirmMany.mockRejectedValueOnce(new Error('boom'))
      fireEvent.click(checkbox(/ネット代/)[0])

      fireEvent.click(screen.getByRole('button', { name: '選択した提案を確定' }))

      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.queryByText('1件の仕訳を確定しました')).not.toBeInTheDocument()
    })
  })
})
