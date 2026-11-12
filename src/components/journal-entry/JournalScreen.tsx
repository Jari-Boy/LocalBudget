import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import { traceExpenseSplittingHistory } from '../../domain/expense-splitting/traceExpenseSplittingHistory'
import { checkExpenseSplittability } from '../../domain/expense-splitting/checkExpenseSplittability'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type { JournalEntryDraft } from '../../domain/journal/JournalEntryDraft'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { filterJournalEntries } from '../../domain/journal/filterJournalEntries'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import type { JournalEntryLinkGroup, JournalEntryLinkGroupMembership } from '../../domain/journal-link-group/JournalEntryLinkGroup'
import type { JournalEntryLinkGroupRepository } from '../../domain/journal-link-group/JournalEntryLinkGroupRepository'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { groupRelatedEntriesByLinkGroup } from '../../domain/journal-link-group/groupRelatedEntriesByLinkGroup'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import type {
  PendingRecurringTransactionProposal,
  RecurringTransactionProposalRpcApi,
} from '../../infrastructure/rpc/createRecurringTransactionProposalApi'
import type { JournalEntryDraftRpcApi } from '../../infrastructure/rpc/createRepositoryRegistry'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import type {
  RecurringTransactionRule,
  RecurringTransactionRuleLine,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { JournalFilterPanel, type JournalFilterOptions } from '../common/journal-filter/JournalFilterPanel'
import { JournalResultList } from '../common/journal-result/JournalResultList'
import { SOURCE_TAGS, DRAFT_TAG, type JournalResultItem } from '../common/journal-result/journalResultModel'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import type { MaybeAsync } from '../master/maybeAsync'
import { UnsavedChangesDialog } from '../common/unsaved-changes/UnsavedChangesDialog'
import { useUnsavedChangesGuard } from '../common/unsaved-changes/unsavedChangesGuard'
import { canCreateRuleFromEntry } from '../../domain/recurring-transaction/canCreateRuleFromEntry'
import { AccountCreateForm } from '../master/AccountCreateForm'
import { CreateRuleFromEntryDialog } from './CreateRuleFromEntryDialog'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import { JournalEntryEditor, type JournalEditorLine, type JournalEditorMaster, type JournalEditorValue } from './JournalEntryEditor'
import {
  createEmptyJournalEntryFormLine,
  fromJournalEntryDraftLine,
  fromJournalLine,
  hasNonPositiveAmountInput,
  isCounterpartyEligibleCategory,
  toJournalEntryDraftLineInput,
  toJournalLineInput,
  type JournalEntryFormLine,
} from './journalEntryFormLine'
import {
  buildDeleteImpactNotes,
  describeIncompleteReason,
  describeSplitBlock,
  findIncompleteReason,
  isProposalBlocked,
  proposalKey,
  matchedAccountIdsOf,
  pickSelectionAfterDelete,
  sortProposalsOldestFirst,
  toggleAllProposals,
  toggleProposalChecked,
  toMatchedResultItem,
} from './journalScreenModel'
import {
  EMPTY_BULK_PICK,
  bulkEditRules,
  buildBulkUpdates,
  sanitizeBulkPick,
  type BulkPick,
  type BulkSelectedLine,
} from './journalBulkEditModel'
import { JournalLineBulkBar } from './JournalLineBulkBar'
import { JournalLineTable, type JournalLineTableEditing, type JournalLineTableLookup } from './JournalLineTable'
import { loadJournalViewMode, saveJournalViewMode, type JournalViewMode } from './journalViewMode'
import { RelatedEntriesSection } from './RelatedEntriesSection'
import './JournalScreen.css'

export type JournalScreenTab = 'list' | 'drafts' | 'proposals' | 'rules'

export interface JournalScreenProps {
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll' | 'create' | 'update' | 'delete'>>
  journalEntryDraftRepository: MaybeAsync<
    Pick<JournalEntryDraftRpcApi, 'findAll' | 'create' | 'update' | 'delete' | 'confirm'>
  >
  journalEntryLinkGroupRepository: MaybeAsync<
    Pick<
      JournalEntryLinkGroupRepository,
      | 'findAllMemberships'
      | 'findAllGroups'
      | 'createGroup'
      | 'joinOrCreateGroups'
      | 'renameGroup'
      | 'removeMember'
      | 'moveMember'
    >
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll' | 'create'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll' | 'create'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll' | 'create'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<Pick<SettlementBatchRepository, 'findAll' | 'create'>>
  recurringTransactionProposalApi: MaybeAsync<Pick<RecurringTransactionProposalRpcApi, 'listPending' | 'confirm' | 'confirmMany' | 'skip'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll' | 'create'>>
  /** 「この仕訳を割勘」を押したときの移動(割勘の入力フォームへ) */
  onSplit: (entry: JournalEntry) => void
  /** 提案を確定・見送りしたとき(サイドナビのバッジの件数を取り直すため) */
  onProposalsChanged?: () => void
  initialTab?: JournalScreenTab
  /**
   * 「定期仕訳」タブ(定期仕訳のルールの管理、計画Issue #180)の中身。ルールの一覧・作成・編集は専用の画面部品が
   * 受け持つため、呼び出し側(ルート)が組み立てて渡す。省略時はタブを出さない
   */
  rulesPanel?: React.ReactNode
  /** 最初に選ぶ仕訳(割勘の履歴などから開くとき) */
  initialEntryId?: number
  /** 最初の絞り込み条件(分析画面から、期間と選んだ条件を引き継いで開くとき。計画Issue #155) */
  initialFilter?: JournalEntryFilter
}

interface LoadedData {
  entries: JournalEntry[]
  drafts: JournalEntryDraft[]
  accounts: Account[]
  accountGroups: AccountGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  members: HouseholdMember[]
  batches: SettlementBatch[]
  memberships: JournalEntryLinkGroupMembership[]
  groups: JournalEntryLinkGroup[]
  proposals: PendingRecurringTransactionProposal[]
  rules: RecurringTransactionRule[]
}

type Selection =
  | { kind: 'entry'; id: number }
  | { kind: 'new' }
  | { kind: 'draft'; id: number }
  | { kind: 'proposal'; ruleId: number; dueDate: string }

interface ProposalRow {
  id: number
  ruleId: number
  /** 土日の調整前の期日 */
  dueDate: string
  /** 土日の調整後の日付(確定すると仕訳の取引日になる) */
  entryDate: string
  /** 一覧に出す金額(初期値の借方の合計) */
  defaultAmount: number
  /** 確認パネルの行の初期値(固定ならルールの行、前回確定額なら前回の仕訳と対応づけた金額、計画Issue #180) */
  defaultLines: RecurringTransactionRuleLine[]
  rule: RecurringTransactionRule
}

/** YYYY-MM-DDを「2026/11/1」の形に(一覧の日付表示と同じ、ゼロ埋めなし) */
const slashDate = (date: string) => date.split('-').map(Number).join('/')

const today = () => new Date().toISOString().slice(0, 10)

/** 詳細パネルの編集内容の比較用の文字列。行の通し番号(key)は含めず、入力値だけを見る */
function serializeEditor(value: JournalEditorValue): string {
  return JSON.stringify({ ...value, lines: value.lines.map((l) => l.line) })
}

function inactiveIds(items: ReadonlyArray<{ id: number; isActive: boolean }>): Set<number> {
  return new Set(items.filter((i) => !i.isActive).map((i) => i.id))
}

/**
 * 仕訳画面(計画Issue #152)。絞り込み・結果一覧・詳細を1画面にまとめ、「仕訳一覧」「下書き」
 * 「承認待ちの定期仕訳」の3つのタブが同じ詳細パネルを使う。確定済みの仕訳は編集・削除・割勘への移動、
 * 下書きは貸借が合わなくても保存でき完成すれば確定、定期仕訳の提案は金額を直して確定か「今回は見送る」
 * で処理する。保存時は精算バッチのタグとコメントを行に保持したまま更新する(計画Issue #144)。
 * 確定済みの仕訳の削除は物理削除で元に戻せない(docs/domain/journal.md 1.5)ため、2回押して確定し、
 * 確認中は影響を表示する。関連仕訳は詳細の最下部に常に出す。旧画面(一覧・詳細・入力フォーム・
 * 下書き一覧・提案の確認・関連仕訳ダイアログ)を置き換えた。
 */
export function JournalScreen(props: JournalScreenProps) {
  const {
    journalEntryRepository,
    journalEntryDraftRepository,
    journalEntryLinkGroupRepository,
    recurringTransactionProposalApi,
    settlementBatchRepository,
    counterpartyRepository,
    onSplit,
    onProposalsChanged,
  } = props
  const { t } = useTranslation('journal')
  const { t: tCommon } = useTranslation('common')

  const [data, setData] = useState<LoadedData | null>(null)
  const [tab, setTab] = useState<JournalScreenTab>(props.initialTab ?? 'list')
  /** 仕訳一覧タブの表示方式(計画Issue #182)。localStorageに保存し、再訪時に復元する。初期値は仕訳単位 */
  const [viewMode, setViewMode] = useState<JournalViewMode>(loadJournalViewMode)
  /** 明細行単位の表で、選択中の仕訳をインライン編集しているか。仕訳を開き直す(open)たびに解除する */
  const [lineEditing, setLineEditing] = useState(false)
  /** 明細行単位の一括編集(計画Issue #182): 選択中の明細行のid(仕訳をまたぐ)、変える項目の選択、適用の確認中か */
  const [bulkLineIds, setBulkLineIds] = useState<number[]>([])
  const [bulkPick, setBulkPick] = useState<BulkPick>(EMPTY_BULK_PICK)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [filter, setFilter] = useState<JournalEntryFilter>(props.initialFilter ?? {})
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editor, setEditor] = useState<JournalEditorValue | null>(null)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proposalMemberId, setProposalMemberId] = useState<number | ''>('')
  /** まとめて確定のチェック(提案のキー、計画Issue #164)。詳細の選択とは別に持つ */
  const [checkedProposalKeys, setCheckedProposalKeys] = useState<string[]>([])
  /** まとめて確定で、起票者が決まっていないルールの分に使う起票者 */
  const [bulkMemberId, setBulkMemberId] = useState<number | ''>('')
  /** 「定期仕訳にする」のダイアログ(計画Issue #180)。元にする仕訳 */
  const [ruleDialogEntry, setRuleDialogEntry] = useState<JournalEntry | null>(null)
  /** プロジェクトの追加ダイアログ(行のプロジェクトの選択ツリーの「+ 新規追加」、計画Issue #180) */
  const [projectDialog, setProjectDialog] = useState<{ apply: (id: number) => void } | null>(null)
  /** 科目の登録ダイアログ(行の科目の選択ツリーの「+ 新規追加」、計画Issue #180) */
  const [accountDialog, setAccountDialog] = useState<{ apply: (id: number) => void } | null>(null)
  const [counterpartyDialog, setCounterpartyDialog] = useState<{ apply: (id: number) => void } | null>(null)
  /** 詳細を開いた時点の編集内容。現在の内容と違えば、未保存の変更がある */
  const [baseline, setBaseline] = useState('')
  /** 未保存の変更があるまま移動しようとしたときの、保存か破棄の後に実行する移動 */
  const [leaveRequest, setLeaveRequest] = useState<(() => void) | null>(null)
  const guard = useUnsavedChangesGuard()
  const lineKey = useRef(0)
  const selectionRef = useRef<Selection | null>(null)
  selectionRef.current = selection

  const fetchAll = async (): Promise<LoadedData> => {
    const [entries, drafts, accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members, batches, memberships, groups, proposals, rules] =
      await Promise.all([
        journalEntryRepository.findAll(),
        journalEntryDraftRepository.findAll(),
        props.accountRepository.findAll(),
        props.accountGroupRepository.findAll(),
        counterpartyRepository.findAll(),
        props.counterpartyGroupRepository.findAll(),
        props.projectRepository.findAll(),
        props.projectGroupRepository.findAll(),
        props.householdMemberRepository.findAll(),
        settlementBatchRepository.findAll(),
        journalEntryLinkGroupRepository.findAllMemberships(),
        journalEntryLinkGroupRepository.findAllGroups(),
        recurringTransactionProposalApi.listPending(),
        props.recurringTransactionRuleRepository.findAll(),
      ])
    return {
      entries, drafts, accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups,
      members, batches, memberships, groups, proposals: [...proposals], rules,
    }
  }

  // ---- 派生データ ----
  const derived = useMemo(() => {
    if (data === null) return null
    const accountById = new Map(data.accounts.map((a) => [a.id, a]))
    const accountNameOf = (id: number) => accountById.get(id)?.name ?? '(不明な科目)'
    const filterContext = {
      accountGroups: data.accountGroups,
      counterparties: data.counterparties,
      counterpartyGroups: data.counterpartyGroups,
      projects: data.projects,
      projectGroups: data.projectGroups,
    }
    const accountCategories = buildTreeSelectCategories(
      buildAccountTree({ groups: data.accountGroups, accounts: data.accounts, memberNameById: new Map() }),
      inactiveIds(data.accounts),
    ).filter((c) => c.nodes.length > 0)
    const counterpartyCategories = buildTreeSelectCategories(
      buildCounterpartyTree({
        groups: data.counterpartyGroups,
        counterparties: data.counterparties,
        accountNameById: new Map(),
        patternCountById: new Map(),
      }),
      inactiveIds(data.counterparties),
    )
    const projectCategories = buildTreeSelectCategories(
      buildProjectTree({ groups: data.projectGroups, projects: data.projects }),
      inactiveIds(data.projects),
    )
    const filterOptions: JournalFilterOptions = {
      accountCategories,
      counterpartyCategories,
      projectCategories,
      members: data.members.map((m) => ({ value: String(m.id), name: m.name })),
      batches: data.batches.map((b) => ({ value: String(b.id), name: b.name })),
      sourceTypes: Object.entries(SOURCE_TAGS).map(([value, tag]) => ({ value, name: tag.label })),
    }
    const master: JournalEditorMaster = {
      accounts: data.accounts,
      accountCategories,
      counterpartyCategories,
      projectCategories,
      members: data.members,
      batches: data.batches,
    }
    const relatedIdsByEntryId = buildRelatedEntryIdsByEntryId(data.memberships)
    const proposalRows: ProposalRow[] = sortProposalsOldestFirst(data.proposals).flatMap((p, index) => {
      const rule = data.rules.find((r) => r.id === p.ruleId)
      return rule === undefined
        ? []
        : [{ id: index + 1, ruleId: p.ruleId, dueDate: p.dueDate, entryDate: p.entryDate, defaultAmount: p.defaultAmount, defaultLines: p.defaultLines, rule }]
    })
    return { accountById, accountNameOf, filterContext, filterOptions, master, relatedIdsByEntryId, proposalRows }
  }, [data])

  const matchedIds = useMemo(
    () => (data === null ? undefined : matchedAccountIdsOf(filter, data.accounts, data.accountGroups)),
    [data, filter],
  )

  const visibleEntries = useMemo(() => {
    if (data === null || derived === null) return []
    return filterJournalEntries(data.entries, data.accounts, filter, derived.filterContext).sort(
      (a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id,
    )
  }, [data, derived, filter])

  const sortedDrafts = useMemo(
    () => [...(data?.drafts ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id),
    [data],
  )

  // ---- 詳細パネルに載せる値の組み立て ----
  const withKeys = (lines: JournalEntryFormLine[]): JournalEditorLine[] =>
    lines.map((line) => ({ key: (lineKey.current += 1), line }))

  /** 新しい仕訳の空の2行。明細行の世帯メンバーの既定値は起票者(計画Issue #169) */
  const emptyLines = (memberId: number | null) =>
    withKeys([
      { ...createEmptyJournalEntryFormLine(), side: 'debit', householdMemberId: memberId },
      { ...createEmptyJournalEntryFormLine(), side: 'credit', householdMemberId: memberId },
    ])

  function buildValue(sel: Selection, d: LoadedData): JournalEditorValue | null {
    const firstMember = d.members.find((m) => m.isActive)?.id ?? null
    if (sel.kind === 'new') {
      return { entryDate: today(), memo: '', comment: '', householdMemberId: firstMember, lines: emptyLines(firstMember) }
    }
    if (sel.kind === 'entry') {
      const entry = d.entries.find((e) => e.id === sel.id)
      if (entry === undefined) return null
      return {
        entryDate: entry.entryDate,
        memo: entry.memo ?? '',
        comment: entry.comment ?? '',
        householdMemberId: entry.householdMemberId,
        lines: withKeys(entry.lines.map(fromJournalLine)),
      }
    }
    if (sel.kind === 'draft') {
      const draft = d.drafts.find((x) => x.id === sel.id)
      if (draft === undefined) return null
      const draftMember = draft.householdMemberId ?? firstMember
      const accountDefaultOf = (accountId: number | null) =>
        accountId === null ? null : (d.accounts.find((a) => a.id === accountId)?.householdMemberId ?? null)
      return {
        entryDate: draft.entryDate ?? today(),
        memo: draft.memo ?? '',
        comment: draft.comment ?? '',
        householdMemberId: draftMember,
        // 下書きの未入力の世帯メンバーは、再開時に科目の既定メンバー、無ければ起票者で補う(明細行は常に世帯メンバーを持つ)
        lines:
          draft.lines.length > 0
            ? withKeys(
                draft.lines.map((l) => {
                  const formLine = fromJournalEntryDraftLine(l)
                  return {
                    ...formLine,
                    householdMemberId: formLine.householdMemberId ?? accountDefaultOf(formLine.accountId) ?? draftMember,
                  }
                }),
              )
            : emptyLines(draftMember),
      }
    }
    const rule = d.rules.find((r) => r.id === sel.ruleId)
    if (rule === undefined) return null
    const proposal = d.proposals.find((p) => p.ruleId === sel.ruleId && p.dueDate === sel.dueDate)
    const accountById = new Map(d.accounts.map((a) => [a.id, a]))
    // 行の世帯メンバーは、行で決まっていればそれ、無ければ科目の既定メンバー、起票者、先頭のメンバーの順(計画Issue #169・#180)
    const bookkeeper = rule.bookkeeperHouseholdMemberId
    const formLines: JournalEntryFormLine[] = (proposal?.defaultLines ?? rule.lines).map((line) => {
      const account = accountById.get(line.accountId)
      return {
        accountId: line.accountId,
        side: line.side,
        amountInput: String(line.amount),
        projectId: line.projectId,
        householdMemberId: line.householdMemberId ?? account?.householdMemberId ?? bookkeeper ?? firstMember,
        counterpartyId: account !== undefined && isCounterpartyEligibleCategory(account.category) ? line.counterpartyId : null,
        settlementBatchId: line.settlementBatchId,
      }
    })
    return {
      entryDate: proposal?.entryDate ?? sel.dueDate,
      memo: rule.name,
      comment: '',
      householdMemberId: bookkeeper,
      lines: withKeys(formLines),
    }
  }

  function open(sel: Selection | null, d: LoadedData) {
    setFlash('')
    setError('')
    setDeleteArmed(false)
    setProposalMemberId('')
    setLineEditing(false)
    const value = sel === null ? null : buildValue(sel, d)
    setSelection(sel)
    setEditor(value)
    setBaseline(value === null ? '' : serializeEditor(value))
  }

  const firstOf = (which: JournalScreenTab, d: LoadedData, entries: JournalEntry[]): Selection | null => {
    if (which === 'list') return entries[0] ? { kind: 'entry', id: entries[0].id } : null
    if (which === 'drafts') {
      const first = [...d.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0]
      return first ? { kind: 'draft', id: first.id } : null
    }
    if (which === 'rules') return null
    const first = sortProposalsOldestFirst(d.proposals).find((p) => d.rules.some((r) => r.id === p.ruleId))
    return first ? { kind: 'proposal', ruleId: first.ruleId, dueDate: first.dueDate } : null
  }

  useEffect(() => {
    let cancelled = false
    void fetchAll().then((d) => {
      if (cancelled) return
      setData(d)
      const sorted = [...d.entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id)
      const initialTab = props.initialTab ?? 'list'
      const target: Selection | null =
        props.initialEntryId !== undefined && d.entries.some((e) => e.id === props.initialEntryId)
          ? { kind: 'entry', id: props.initialEntryId }
          : firstOf(initialTab, d, sorted)
      open(target, d)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 定期仕訳の提案は確定か見送りで処理するもので保存の対象ではないため、未保存の判定から外す
  const dirty =
    editor !== null && selection !== null && selection.kind !== 'proposal' && serializeEditor(editor) !== baseline

  // 画面の外(サイドナビなど)への移動と、リロード・タブを閉じる操作の前に確認を挟む
  useEffect(() => {
    if (!dirty) return
    guard.register((proceed) => {
      setLeaveRequest(() => proceed)
      return true
    })
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => {
      guard.register(null)
      window.removeEventListener('beforeunload', warnBeforeUnload)
    }
  }, [dirty, guard])

  if (data === null || derived === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { accountNameOf, master, filterOptions, relatedIdsByEntryId, proposalRows } = derived

  /** 画面内の移動。未保存の変更があれば、保存か破棄かを聞いてから実行する */
  const guarded = (action: () => void) => {
    if (dirty) setLeaveRequest(() => action)
    else action()
  }

  /** 保存・削除などの後にデータを取り直し、指定の選択で詳細を開き直す */
  async function reloadAndOpen(pick: (d: LoadedData) => Selection | null, message = '') {
    const d = await fetchAll()
    setData(d)
    open(pick(d), d)
    setFlash(message)
  }

  const mapError = (err: unknown, fallback: string): string => {
    if (err instanceof UnbalancedJournalEntryError) {
      return err.message.includes('at least 2 lines') ? t('insufficientLinesError') : t('unbalancedError')
    }
    if (err instanceof SettlementBatchOnNonAdvanceAccountError) return t('settlementBatchOnNonAdvanceAccountError')
    if (err instanceof RecurringTransactionHouseholdMemberRequiredError) return '起票者を選んでください'
    return fallback
  }

  /** 操作を実行する。最後まで成功したか(actionがtrueを返したか)を返す */
  const run = async (action: () => Promise<boolean | void>, fallback: string): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError('')
    setFlash('')
    try {
      return (await action()) === true
    } catch (err) {
      setError(mapError(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  // ---- 詳細パネルの操作 ----
  const lineInputs = () => (editor?.lines ?? []).map((l) => l.line)

  /** 確定できるかを検証する。問題があれば画面に出して null を返す */
  function validatedLines() {
    if (editor === null) return null
    if (lineInputs().some(hasNonPositiveAmountInput)) {
      setError(t('negativeAmountError'))
      return null
    }
    const reason = findIncompleteReason(lineInputs())
    if (reason !== null) {
      setError(`${describeIncompleteReason(reason)}ため保存できません`)
      return null
    }
    return lineInputs().map(toJournalLineInput).filter((l) => l !== null)
  }

  const saveEntry = (andNew: boolean) =>
    run(async () => {
      if (editor === null || selection === null) return
      const lines = validatedLines()
      if (lines === null) return
      const common = {
        entryDate: editor.entryDate,
        memo: editor.memo === '' ? null : editor.memo,
        comment: editor.comment === '' ? null : editor.comment,
        lines,
      }
      let savedId: number
      if (selection.kind === 'new') {
        const created = await journalEntryRepository.create({
          ...common,
          householdMemberId: editor.householdMemberId as number,
        })
        savedId = created.id
      } else {
        await journalEntryRepository.update((selection as { id: number }).id, {
          ...common,
          ...(editor.householdMemberId === null ? {} : { householdMemberId: editor.householdMemberId }),
        })
        savedId = (selection as { id: number }).id
      }
      await reloadAndOpen(
        () => (andNew ? { kind: 'new' } : { kind: 'entry', id: savedId }),
        andNew ? '保存しました。続けて入力できます' : '保存しました',
      )
      return true
    }, t('updateError'))

  const saveDraft = (after: 'stay' | 'new') =>
    run(async () => {
      if (editor === null || selection === null) return
      const input = {
        entryDate: editor.entryDate === '' ? null : editor.entryDate,
        memo: editor.memo === '' ? null : editor.memo,
        comment: editor.comment === '' ? null : editor.comment,
        householdMemberId: editor.householdMemberId,
        lines: editor.lines.map((l) => toJournalEntryDraftLineInput(l.line)),
      }
      let draftId: number
      if (selection.kind === 'draft') {
        await journalEntryDraftRepository.update(selection.id, input)
        draftId = selection.id
      } else {
        draftId = (await journalEntryDraftRepository.create(input)).id
      }
      await reloadAndOpen(
        () => (after === 'new' ? { kind: 'new' } : { kind: 'draft', id: draftId }),
        '下書きを保存しました',
      )
      return true
    }, t('updateError'))

  const confirmDraft = () =>
    run(async () => {
      if (editor === null || selection?.kind !== 'draft') return
      if (validatedLines() === null) return
      await journalEntryDraftRepository.update(selection.id, {
        entryDate: editor.entryDate,
        memo: editor.memo === '' ? null : editor.memo,
        comment: editor.comment === '' ? null : editor.comment,
        householdMemberId: editor.householdMemberId,
        lines: editor.lines.map((l) => toJournalEntryDraftLineInput(l.line)),
      })
      const entry = await journalEntryDraftRepository.confirm(selection.id)
      await reloadAndOpen((d) => firstOf('drafts', d, []) ?? { kind: 'entry', id: entry.id }, '仕訳を確定しました')
      if (!(await hasDraftsLeft())) setTab('list')
    }, t('confirmError'))

  const hasDraftsLeft = async () => (await journalEntryDraftRepository.findAll()).length > 0

  const deleteDraft = () =>
    run(async () => {
      if (selection?.kind !== 'draft') return
      const nextId = pickSelectionAfterDelete(sortedDrafts.map((d) => d.id), selection.id)
      await journalEntryDraftRepository.delete(selection.id)
      await reloadAndOpen(() => (nextId === null ? null : { kind: 'draft', id: nextId }))
    }, t('updateError'))

  const deleteEntry = () => {
    if (selection?.kind !== 'entry') return
    if (!deleteArmed) {
      setDeleteArmed(true)
      setFlash('')
      return
    }
    void run(async () => {
      const nextId = pickSelectionAfterDelete(visibleEntries.map((e) => e.id), selection.id)
      await journalEntryRepository.delete(selection.id)
      await reloadAndOpen(() => (nextId === null ? null : { kind: 'entry', id: nextId }), '仕訳を削除しました')
    }, t('updateError'))
  }

  const selectedProposal =
    selection?.kind === 'proposal'
      ? proposalRows.find((p) => p.ruleId === selection.ruleId && p.dueDate === selection.dueDate)
      : undefined
  const proposalBlocked = selectedProposal !== undefined && isProposalBlocked(selectedProposal, proposalRows)

  const afterProposal = async (message: string) => {
    const current = selectedProposal
    await reloadAndOpen((d) => {
      const rows = sortProposalsOldestFirst(d.proposals).filter((p) => d.rules.some((r) => r.id === p.ruleId))
      const next = rows.find((p) => !(p.ruleId === current?.ruleId && p.dueDate === current?.dueDate)) ?? null
      return next ? { kind: 'proposal', ruleId: next.ruleId, dueDate: next.dueDate } : null
    }, message)
    onProposalsChanged?.()
  }

  const confirmProposal = () =>
    run(async () => {
      if (editor === null || selectedProposal === undefined) return
      const lines = validatedLines()
      if (lines === null) return
      const memberId = selectedProposal.rule.bookkeeperHouseholdMemberId === null ? proposalMemberId : ''
      await Promise.resolve().then(() =>
        recurringTransactionProposalApi.confirm({
          ruleId: selectedProposal.ruleId,
          dueDate: selectedProposal.dueDate,
          lines,
          householdMemberId: memberId === '' ? undefined : memberId,
          memo: editor.memo,
          comment: editor.comment,
        }),
      )
      await afterProposal('仕訳帳に反映しました')
    }, t('confirmError'))

  const skipProposal = () =>
    run(async () => {
      if (selectedProposal === undefined) return
      await Promise.resolve().then(() =>
        recurringTransactionProposalApi.skip({ ruleId: selectedProposal.ruleId, dueDate: selectedProposal.dueDate }),
      )
      await afterProposal('この回を見送りました。仕訳は作られません')
    }, t('updateError'))

  // ---- 提案のまとめて確定(計画Issue #164) ----
  /** チェックされている提案(消えた提案のキーは捨てる)。古い順に並ぶ */
  const checkedRows = proposalRows.filter((p) => checkedProposalKeys.includes(proposalKey(p)))
  const bulkNoMemberRows = checkedRows.filter((p) => p.rule.bookkeeperHouseholdMemberId === null)
  const bulkNeedsMember = bulkNoMemberRows.length > 0
  const bulkNoMemberNames = [...new Set(bulkNoMemberRows.map((p) => p.rule.name))].join('、')

  const toggleProposal = (id: number) => {
    const row = proposalRows.find((p) => p.id === id)
    if (row) setCheckedProposalKeys(toggleProposalChecked(proposalRows, checkedProposalKeys, row))
  }

  const confirmChecked = () =>
    run(async () => {
      if (checkedRows.length === 0) return
      const count = checkedRows.length
      const householdMemberId = bulkNeedsMember && bulkMemberId !== '' ? bulkMemberId : undefined
      await Promise.resolve().then(() =>
        recurringTransactionProposalApi.confirmMany({
          items: checkedRows.map(({ ruleId, dueDate }) => ({ ruleId, dueDate })),
          householdMemberId,
        }),
      )
      setCheckedProposalKeys([])
      setBulkMemberId('')
      await reloadAndOpen((d) => {
        const next = sortProposalsOldestFirst(d.proposals).find((p) => d.rules.some((r) => r.id === p.ruleId))
        return next ? { kind: 'proposal', ruleId: next.ruleId, dueDate: next.dueDate } : null
      }, `${count}件の仕訳を仕訳帳に反映しました`)
      onProposalsChanged?.()
    }, t('confirmError'))

  /** 提案は1借方・1貸方で同額のため、片方の金額を直したらもう片方も合わせる */
  const changeEditor = (next: JournalEditorValue) => {
    if (selection?.kind === 'proposal' && editor !== null) {
      const changed = next.lines.find((l, i) => l.line.amountInput !== editor.lines[i]?.line.amountInput)
      if (changed) {
        setEditor({ ...next, lines: next.lines.map((l) => ({ ...l, line: { ...l.line, amountInput: changed.line.amountInput } })) })
        return
      }
    }
    setEditor(next)
  }

  // ---- 関連仕訳 ----
  const selectedEntry = selection?.kind === 'entry' ? data.entries.find((e) => e.id === selection.id) : undefined
  const entriesById = new Map(data.entries.map((e) => [e.id, e]))
  const relatedIds = selectedEntry ? (relatedIdsByEntryId.get(selectedEntry.id) ?? new Set<number>()) : new Set<number>()
  const relatedGroups = selectedEntry
    ? groupRelatedEntriesByLinkGroup(selectedEntry.id, data.memberships, new Map(data.groups.map((g) => [g.id, g])), entriesById)
    : []

  const relationAction = (action: () => Promise<void> | void) =>
    run(async () => {
      await action()
      const current = selectionRef.current
      const d = await fetchAll()
      setData(d)
      setDeleteArmed(false)
      if (current?.kind === 'entry') setSelection(current)
    }, t('relateEntryError'))

  const findCandidates = (candidateFilter: JournalEntryFilter) =>
    filterJournalEntries(
      data.entries.filter((e) => e.id !== selectedEntry?.id && !relatedIds.has(e.id)),
      data.accounts,
      candidateFilter,
      derived.filterContext,
    ).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id - a.id)

  // ---- 割勘 ----
  const split = selectedEntry
    ? checkExpenseSplittability(
        selectedEntry,
        data.accounts,
        [...relatedIds].map((id) => entriesById.get(id)).filter((e): e is JournalEntry => e !== undefined),
      )
    : null

  const trails = selectedEntry
    ? traceExpenseSplittingHistory(selectedEntry, data.entries, data.accounts, relatedIdsByEntryId)
    : []

  // ---- 一覧の行 ----
  const listItems: JournalResultItem[] = visibleEntries.map((e) => toMatchedResultItem(e, accountNameOf, matchedIds))
  const draftItems: JournalResultItem[] = sortedDrafts.map((d) => ({
    id: d.id,
    sourceType: 'draft',
    memo: d.memo && d.memo !== '' ? d.memo : '(摘要なし)',
    amount: d.lines.filter((l) => l.side === 'debit').reduce((sum, l) => sum + (l.amount ?? 0), 0),
    currency: d.currency ?? 'JPY',
    entryDate: d.entryDate ?? d.updatedAt.slice(0, 10),
    debitSummary: '',
    creditSummary: '',
  }))
  const proposalItems: JournalResultItem[] = proposalRows.map((p) => ({
    id: p.id,
    sourceType: 'recurring_generated',
    memo: p.rule.name,
    amount: p.defaultAmount,
    currency: 'JPY',
    entryDate: p.entryDate,
    // 一覧には科目を出さない(hideAccounts)。土日の調整でずらした提案には、調整前の期日を添える
    debitSummary: '',
    creditSummary: '',
    note: p.entryDate === p.dueDate ? undefined : `期日 ${slashDate(p.dueDate)}`,
  }))

  /** 一括編集の選択と、変える項目の選択・確認をすべて解く(タブ・表示方式の切替、インライン編集の開始のとき) */
  const resetBulk = () => {
    setBulkLineIds([])
    setBulkPick(EMPTY_BULK_PICK)
    setBulkConfirming(false)
  }

  const switchTab = (next: JournalScreenTab) =>
    guarded(() => {
      resetBulk()
      setTab(next)
      open(firstOf(next, data, visibleEntries), data)
    })

  /** 精算バッチをその場で作る(行の精算バッチの選択肢の「+ 新しいバッチ」) */
  const createBatch = async (name: string) => {
    const created = await settlementBatchRepository.create({ name, type: 'expense_splitting' })
    setData((prev) => (prev === null ? prev : { ...prev, batches: [...prev.batches, created] }))
    return created
  }

  const cancelLeave = () => setLeaveRequest(null)

  const discardAndLeave = () => {
    const next = leaveRequest
    setLeaveRequest(null)
    next?.()
  }

  /** 編集中の内容を保存し、保存できたときだけ移動する(保存できなければ理由を出して編集に残る) */
  const saveAndLeave = async () => {
    const next = leaveRequest
    if (next === null) return
    setLeaveRequest(null)
    const saved = selection?.kind === 'draft' ? await saveDraft('stay') : await saveEntry(false)
    if (saved) next()
  }

  const tabs: { key: JournalScreenTab; label: string }[] = [
    { key: 'list', label: '仕訳一覧' },
    { key: 'drafts', label: `下書き ${data.drafts.length}` },
    { key: 'proposals', label: `承認待ち ${proposalRows.length}` },
    ...(props.rulesPanel === undefined ? [] : [{ key: 'rules' as const, label: '定期仕訳' }]),
  ]

  const selectedIds =
    selection === null
      ? []
      : selection.kind === 'entry' || selection.kind === 'draft'
        ? [selection.id]
        : selection.kind === 'proposal'
          ? selectedProposal
            ? [selectedProposal.id]
            : []
          : []

  /** 「定期仕訳にする」を押せるか(割勘・初期残高・残高調整の仕訳は作れない、計画Issue #180) */
  const ruleCheck = selectedEntry ? canCreateRuleFromEntry(selectedEntry) : ({ allowed: true } as const)
  const incompleteReason = editor === null ? null : findIncompleteReason(lineInputs())
  const stagedReason = (() => {
    if (selection?.kind === 'proposal') {
      if (proposalBlocked) return '先に同じルールの古い提案を確定するか見送ってください'
      if (selectedProposal?.rule.bookkeeperHouseholdMemberId === null && proposalMemberId === '') return '起票者を選んでください'
    }
    return incompleteReason === null ? '' : describeIncompleteReason(incompleteReason)
  })()

  const deleteNotes =
    selectedEntry === undefined
      ? []
      : buildDeleteImpactNotes({
          sourceType: selectedEntry.sourceType,
          batchNames: [
            ...new Set(
              selectedEntry.lines
                .map((l) => l.settlementBatchId)
                .filter((id): id is number => id !== null)
                .map((id) => data.batches.find((b) => b.id === id)?.name)
                .filter((n): n is string => n !== undefined),
            ),
          ],
          isRelated: relatedIds.size > 0 || data.memberships.some((m) => m.journalEntryId === selectedEntry.id),
        })

  // ---- 明細行単位の表示(計画Issue #182) ----
  /**
   * 明細行単位の表を出しているか。「新規仕訳」の入力欄は詳細パネルにあるため、新規のときだけは
   * 保存した表示方式にかかわらず仕訳単位の画面で開く(保存して仕訳が選ばれると表に戻る)
   */
  const lineView = tab === 'list' && viewMode === 'line' && selection?.kind !== 'new'

  /** 表示方式を切り替える。未保存の変更があれば先に聞き、切り替えたら開いている仕訳を開き直して編集を解く */
  const changeViewMode = (mode: JournalViewMode) => {
    if (mode === (lineView ? 'line' : 'entry')) return
    guarded(() => {
      resetBulk()
      setViewMode(mode)
      saveJournalViewMode(mode)
      open(selection?.kind === 'entry' ? selection : firstOf('list', data, visibleEntries), data)
    })
  }

  /**
   * 表の行を押す: その仕訳を選び、そのまま全行を入力欄にする(編集ボタンはない)。別の仕訳を編集中で
   * 未保存なら、先に保存か破棄かを聞く
   */
  const startLineEdit = (id: number) =>
    guarded(() => {
      // 一括編集の選択は、インライン編集を始めるときに解く(同時には使わない)
      resetBulk()
      open({ kind: 'entry', id }, data)
      setLineEditing(true)
    })

  /** 編集をやめて、編集前の内容に戻す */
  const cancelLineEdit = () => open(selection, data)

  const lineLookup: JournalLineTableLookup = (() => {
    const nameMap = (items: ReadonlyArray<{ id: number; name: string }>) => new Map(items.map((i) => [i.id, i.name]))
    const projects = nameMap(data.projects)
    const counterparties = nameMap(data.counterparties)
    const batches = nameMap(data.batches)
    const members = nameMap(data.members)
    return {
      accountName: accountNameOf,
      projectName: (id) => projects.get(id) ?? '',
      counterpartyName: (id) => counterparties.get(id) ?? '',
      batchName: (id) => batches.get(id) ?? '',
      memberName: (id) => members.get(id) ?? '',
    }
  })()

  // ---- 一括編集(計画Issue #182) ----
  /** 表示中の明細行(選べる行)。絞り込みで見えなくなった行は、選択に含めない */
  const visibleLines: BulkSelectedLine[] = visibleEntries.flatMap((entry) => entry.lines.map((line) => ({ entry, line })))
  const bulkSelected = visibleLines.filter((s) => bulkLineIds.includes(s.line.id))
  const bulkSelectedIds = new Set(bulkSelected.map((s) => s.line.id))
  /** 選択した行に合わせて、選べなくなった項目の選択を外した、変える項目の選択 */
  const effectiveBulkPick = sanitizeBulkPick(bulkPick, bulkEditRules(bulkSelected, bulkPick, derived.accountById))

  /** 選択する行を変える。選択が変わると、確認は取り消し、結果の表示は消す */
  const changeBulkSelection = (ids: number[]) => {
    setBulkLineIds(ids)
    setBulkConfirming(false)
    setFlash('')
    setError('')
  }

  const toggleBulkLine = (lineId: number) =>
    changeBulkSelection(bulkSelectedIds.has(lineId) ? [...bulkSelectedIds].filter((id) => id !== lineId) : [...bulkSelectedIds, lineId])

  /** 見出しのチェック: その側の表示中の行をすべて選ぶ(すべて選択済みなら外す) */
  const toggleBulkSide = (side: JournalLineSide) => {
    const ids = visibleLines.filter((s) => s.line.side === side).map((s) => s.line.id)
    const allOn = ids.length > 0 && ids.every((id) => bulkSelectedIds.has(id))
    changeBulkSelection(allOn ? [...bulkSelectedIds].filter((id) => !ids.includes(id)) : [...new Set([...bulkSelectedIds, ...ids])])
  }

  /**
   * 一括編集を適用する。仕訳ごとに1件ずつ保存し、結果を報告する。一部の仕訳で失敗したら、成功した分はそのまま
   * 反映し、失敗した仕訳と理由を示して、その仕訳の行は選択したまま残す(変える項目の選択も残し、やり直せる)。
   */
  const applyBulk = () =>
    run(async () => {
      const updates = buildBulkUpdates(bulkSelected, effectiveBulkPick, derived.accountById)
      const failed: { entry: JournalEntry; reason: string }[] = []
      for (const update of updates) {
        try {
          await journalEntryRepository.update(update.entry.id, update.input)
        } catch (err) {
          failed.push({ entry: update.entry, reason: mapError(err, t('updateError')) })
        }
      }
      setData(await fetchAll())
      const failedIds = new Set(failed.map((f) => f.entry.id))
      setBulkConfirming(false)
      setBulkLineIds(bulkSelected.filter((s) => failedIds.has(s.entry.id)).map((s) => s.line.id))
      if (failed.length === 0) setBulkPick(EMPTY_BULK_PICK)
      else {
        const detail = failed.map((f) => `「${f.entry.memo ?? '(摘要なし)'}」(${slashDate(f.entry.entryDate)})… ${f.reason}`).join(' / ')
        setError(`${failed.length}件の仕訳は更新できませんでした: ${detail}。更新できなかった仕訳の行は、選択したままです`)
      }
      if (updates.length > failed.length) {
        const doneLines = bulkSelected.filter((s) => !failedIds.has(s.entry.id)).length
        setFlash(`${doneLines}行(${updates.length - failed.length}件の仕訳)を更新しました`)
      }
      return true
    }, t('updateError'))

  const lineEditingProps: JournalLineTableEditing | undefined =
    lineView && lineEditing && selection?.kind === 'entry' && editor !== null
      ? {
          entryId: selection.id,
          value: editor,
          onChange: changeEditor,
          master,
          busy,
          onSave: () => void saveEntry(false),
          onCancel: cancelLineEdit,
          onDelete: deleteEntry,
          onDeleteCancel: () => setDeleteArmed(false),
          deleteArmed,
          deleteNotes,
          error,
          onRequestCreateCounterparty: (apply) => setCounterpartyDialog({ apply }),
          onRequestCreateProject: (apply) => setProjectDialog({ apply }),
          onRequestCreateAccount: (apply) => setAccountDialog({ apply }),
        }
      : undefined

  const sourceTag =
    selection?.kind === 'entry' && selectedEntry
      ? SOURCE_TAGS[selectedEntry.sourceType]
      : selection?.kind === 'draft'
        ? DRAFT_TAG
        : selection?.kind === 'proposal'
          ? SOURCE_TAGS.recurring_generated
          : selection?.kind === 'new'
            ? SOURCE_TAGS.manual
            : null

  const title =
    selection?.kind === 'new'
      ? '新しい仕訳'
      : selection?.kind === 'draft'
        ? '下書き'
        : selection?.kind === 'proposal'
          ? `承認待ちの定期仕訳: ${selectedProposal?.rule.name ?? ''}`
          : editor?.memo
            ? `仕訳の詳細: ${editor.memo}`
            : '仕訳の詳細'

  const note =
    tab === 'proposals'
      ? '起票時期がきた定期仕訳です。内容を編集して承認すると、仕訳帳に反映されます。不要な回は見送れます。同じ定期仕訳は古い順に処理します。チェックを付けて、まとめて承認もできます。'
      : tab === 'drafts'
        ? '保存前の仕訳です。貸借が合わなくても下書きとして残せます。'
        : ''

  return (
    <div className="journal-screen">
      <div className="journal-screen__head">
        <h1 className="journal-screen__title">仕訳</h1>
        <button
          type="button"
          className="journal-screen__button journal-screen__button--primary"
          onClick={() =>
            guarded(() => {
              setTab('list')
              open({ kind: 'new' }, data)
            })
          }
        >
          新規仕訳
        </button>
      </div>

      <div role="tablist" aria-label="仕訳の種類" className="journal-screen__tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`journal-screen__tab${tab === item.key ? ' journal-screen__tab--current' : ''}`}
            onClick={() => switchTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'rules' && props.rulesPanel !== undefined ? (
        <div className="journal-screen__rules">{props.rulesPanel}</div>
      ) : (
        <>
      {tab === 'list' && (
        <div className="journal-screen__filter">
          <JournalFilterPanel filter={filter} onChange={setFilter} options={filterOptions} resultCount={visibleEntries.length} />
        </div>
      )}
      {note !== '' && <p className="journal-screen__note">{note}</p>}

      {tab === 'list' && (
        <div role="group" aria-label="表示方式" className="journal-screen__view-toggle">
          {(
            [
              ['entry', '仕訳単位'],
              ['line', '明細行単位'],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={(lineView ? 'line' : 'entry') === mode}
              className="journal-screen__view-toggle-button"
              onClick={() => changeViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="journal-screen__body">
        <div className={lineView ? 'journal-screen__list journal-screen__list--wide' : 'journal-screen__list'}>
          {tab === 'list' && matchedIds !== undefined && !lineView && (
            <p className="journal-screen__note">科目に一致した明細の金額を表示しています</p>
          )}
          {tab === 'proposals' && (
            <div role="group" aria-label="まとめて確定" className="journal-screen__bulk">
              <div className="journal-screen__bulk-row">
                <label className="journal-screen__bulk-all">
                  <input
                    type="checkbox"
                    checked={proposalRows.length > 0 && checkedRows.length === proposalRows.length}
                    onChange={() => setCheckedProposalKeys(toggleAllProposals(proposalRows, checkedProposalKeys))}
                  />
                  すべて選択
                </label>
                <span className="journal-screen__note">{checkedRows.length}件を選択中</span>
              </div>
              {bulkNeedsMember && (
                <label className="journal-screen__inline-field">
                  起票者(未定のルール用)
                  <select
                    className="journal-screen__select"
                    aria-label="まとめて確定の起票者"
                    value={bulkMemberId}
                    onChange={(e) => setBulkMemberId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">選択してください</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="journal-screen__bulk-row">
                <button
                  type="button"
                  className="journal-screen__button journal-screen__button--primary"
                  disabled={busy || checkedRows.length === 0 || (bulkNeedsMember && bulkMemberId === '')}
                  onClick={() => void confirmChecked()}
                >
                  選択した定期仕訳を承認して反映
                </button>
              </div>
              {bulkNeedsMember && bulkMemberId === '' && (
                <p className="journal-screen__note">
                  起票者が決まっていない提案({bulkNoMemberNames})があります。まとめて起票者を選んでください。
                </p>
              )}
              <p className="journal-screen__note">
                内容は初期値のまま承認します。内容を直す定期仕訳は、開いて1件ずつ承認してください。
              </p>
            </div>
          )}
          {lineView ? (
            <>
              {flash !== '' && (
                <span role="status" className="journal-screen__flash">
                  {flash}
                </span>
              )}
              {/* 編集中のエラーは、編集中の仕訳の操作バーに出る。それ以外(一括編集の一部失敗など)はここに出す */}
              {error !== '' && lineEditingProps === undefined && (
                <p role="alert" className="journal-screen__error">
                  {error}
                </p>
              )}
              {bulkSelected.length > 0 && (
                <JournalLineBulkBar
                  selected={bulkSelected}
                  pick={effectiveBulkPick}
                  onPickChange={(next) => {
                    setBulkPick(next)
                    setBulkConfirming(false)
                  }}
                  master={master}
                  confirming={bulkConfirming}
                  onAskConfirm={() => setBulkConfirming(true)}
                  onCancelConfirm={() => setBulkConfirming(false)}
                  onApply={() => void applyBulk()}
                  onClearSelection={resetBulk}
                  busy={busy}
                />
              )}
              <JournalLineTable
                entries={visibleEntries}
                lookup={lineLookup}
                selectedId={selection?.kind === 'entry' ? selection.id : null}
                onSelect={startLineEdit}
                editing={lineEditingProps}
                bulk={{
                  selectedLineIds: bulkSelectedIds,
                  disabled: lineEditing || busy,
                  onToggleLine: toggleBulkLine,
                  onToggleSide: toggleBulkSide,
                }}
              />
            </>
          ) : (
          <JournalResultList
            items={tab === 'list' ? listItems : tab === 'drafts' ? draftItems : proposalItems}
            hideAccounts={tab === 'proposals'}
            checkable={
              tab === 'proposals'
                ? { checkedIds: checkedRows.map((p) => p.id), onToggle: toggleProposal }
                : undefined
            }
            selectionMode="single"
            selectedIds={selectedIds}
            onSelectionChange={(ids) => {
              const id = ids[0]
              if (id === undefined) return
              if (tab === 'list') guarded(() => open({ kind: 'entry', id }, data))
              else if (tab === 'drafts') guarded(() => open({ kind: 'draft', id }, data))
              else {
                const row = proposalRows.find((p) => p.id === id)
                if (row) guarded(() => open({ kind: 'proposal', ruleId: row.ruleId, dueDate: row.dueDate }, data))
              }
            }}
          />
          )}
        </div>

        {!lineView && (
        <section aria-label="仕訳の詳細" className="journal-screen__detail">
          {editor === null || selection === null ? (
            <p className="journal-screen__note">仕訳を選ぶか、「新規仕訳」を押してください</p>
          ) : (
            <>
              <div className="journal-screen__detail-head">
                <div className="journal-screen__detail-title">
                  {sourceTag && (
                    <span className="journal-screen__tag" style={{ background: sourceTag.bg, color: sourceTag.fg }}>
                      {sourceTag.label}
                    </span>
                  )}
                  <h2>{title}</h2>
                </div>
                {selectedEntry && (
                  <a
                    className="journal-screen__button"
                    href="#related-entries"
                    onClick={(event) => {
                      event.preventDefault()
                      document.getElementById('related-entries')?.scrollIntoView({ block: 'start' })
                    }}
                  >
                    関連仕訳 {relatedIds.size}件
                  </a>
                )}
              </div>

              <JournalEntryEditor
                value={editor}
                onChange={changeEditor}
                master={master}
                lockEntryDate={selection.kind === 'proposal'}
                onCreateBatch={createBatch}
                onRequestCreateCounterparty={(apply) => setCounterpartyDialog({ apply })}
                onRequestCreateProject={(apply) => setProjectDialog({ apply })}
                onRequestCreateAccount={(apply) => setAccountDialog({ apply })}
              />

              {selection.kind === 'proposal' && selectedProposal !== undefined && selectedProposal.entryDate !== selectedProposal.dueDate && (
                <p className="journal-screen__note">
                  期日 {slashDate(selectedProposal.dueDate)} を土日の調整でずらしています
                </p>
              )}

              {selection.kind === 'proposal' && selectedProposal?.rule.bookkeeperHouseholdMemberId === null && (
                <label className="journal-screen__inline-field">
                  起票者
                  <select
                    className="journal-screen__select"
                    value={proposalMemberId}
                    onChange={(e) => setProposalMemberId(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">選択してください</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="journal-screen__actions">
                {(selection.kind === 'entry' || selection.kind === 'new') && (
                  <>
                    <button type="button" className="journal-screen__button journal-screen__button--primary" disabled={busy} onClick={() => void saveEntry(false)}>
                      保存
                    </button>
                    {selection.kind === 'new' && (
                      <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void saveEntry(true)}>
                        保存して続けて入力
                      </button>
                    )}
                  </>
                )}
                {selection.kind === 'new' && (
                  <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void saveDraft('new')}>
                    下書きに保存
                  </button>
                )}
                {selection.kind === 'entry' && selectedEntry && (
                  <>
                    <button
                      type="button"
                      className="journal-screen__button"
                      disabled={busy || !ruleCheck.allowed}
                      aria-describedby="journal-rule-reason"
                      onClick={() => guarded(() => setRuleDialogEntry(selectedEntry))}
                    >
                      定期仕訳にする
                    </button>
                    <span id="journal-rule-reason" className="journal-screen__note">
                      {ruleCheck.allowed ? '' : ruleCheck.reason}
                    </span>
                  </>
                )}
                {selection.kind === 'entry' && split !== null && (
                  <>
                    <button
                      type="button"
                      className="journal-screen__button"
                      disabled={!split.splittable}
                      aria-describedby="journal-split-reason"
                      onClick={() => selectedEntry && guarded(() => onSplit(selectedEntry))}
                    >
                      この仕訳を割勘
                    </button>
                    <span id="journal-split-reason" className="journal-screen__note">
                      {split.splittable ? '' : describeSplitBlock(split.reason)}
                    </span>
                  </>
                )}
                {selection.kind === 'draft' && (
                  <>
                    <button
                      type="button"
                      className="journal-screen__button journal-screen__button--primary"
                      disabled={busy || incompleteReason !== null}
                      onClick={() => void confirmDraft()}
                    >
                      確定して仕訳にする
                    </button>
                    <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void saveDraft('stay')}>
                      下書きを保存
                    </button>
                    <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void deleteDraft()}>
                      削除
                    </button>
                  </>
                )}
                {selection.kind === 'proposal' && (
                  <>
                    <button
                      type="button"
                      className="journal-screen__button journal-screen__button--primary"
                      disabled={busy || stagedReason !== ''}
                      onClick={() => void confirmProposal()}
                    >
                      承認して仕訳帳に反映
                    </button>
                    <button type="button" className="journal-screen__button" disabled={busy || proposalBlocked} onClick={() => void skipProposal()}>
                      今回は見送る
                    </button>
                  </>
                )}
                {(selection.kind === 'draft' || selection.kind === 'proposal') && stagedReason !== '' && (
                  <span className="journal-screen__note">{stagedReason}</span>
                )}
                {flash !== '' && (
                  <span role="status" className="journal-screen__flash">
                    {flash}
                  </span>
                )}
              </div>
              {error !== '' && (
                <p role="alert" className="journal-screen__error">
                  {error}
                </p>
              )}
              {selection.kind === 'entry' && trails.length > 0 && (
                <section aria-label="この支出から生まれた割勘" className="journal-screen__history">
                  <h3 className="journal-screen__history-title">この支出から生まれた割勘</h3>
                  <ul>
                    {trails.map(({ splitEntry, settlementEntries }) => (
                      <li key={splitEntry.id}>
                        <span>{splitEntry.entryDate}</span> <span>{splitEntry.memo ?? '(摘要なし)'}</span>
                        {settlementEntries.length > 0 && (
                          <ul>
                            {settlementEntries.map((settlement) => (
                              <li key={settlement.id}>
                                <span>{settlement.entryDate}</span> <span>{settlement.memo ?? '(摘要なし)'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {selection.kind === 'entry' && selectedEntry && (
                <RelatedEntriesSection
                  groups={relatedGroups}
                  findCandidates={findCandidates}
                  filterOptions={filterOptions}
                  onOpenEntry={(entry) =>
                    guarded(() => {
                      setTab('list')
                      open({ kind: 'entry', id: entry.id }, data)
                    })
                  }
                  onRename={(groupId, name) => void relationAction(() => journalEntryLinkGroupRepository.renameGroup(groupId, name))}
                  onRemove={(groupId, entryId) =>
                    void relationAction(() => journalEntryLinkGroupRepository.removeMember(groupId, entryId))
                  }
                  onMove={(sourceGroupId, targetGroupId, entryId) =>
                    void relationAction(() =>
                      journalEntryLinkGroupRepository.moveMember(sourceGroupId, targetGroupId, selectedEntry.id, entryId),
                    )
                  }
                  onAdd={(entryId) =>
                    void relationAction(() => journalEntryLinkGroupRepository.joinOrCreateGroups([selectedEntry.id], [entryId]))
                  }
                  onAddToNewGroup={(entryId) =>
                    void relationAction(async () => {
                      await journalEntryLinkGroupRepository.createGroup([selectedEntry.id, entryId])
                    })
                  }
                />
              )}

              {selection.kind === 'entry' && selectedEntry && (
                <div className="journal-screen__delete-section">
                  <h3 className="journal-screen__delete-heading">仕訳の削除</h3>
                  {deleteArmed ? (
                    <div role="alert" className="journal-screen__delete-box">
                      <div className="journal-screen__delete-title">この仕訳を削除します。元に戻せません。</div>
                      {deleteNotes.map((note) => (
                        <div key={note}>{note}</div>
                      ))}
                      <div className="journal-screen__delete-actions">
                        <button type="button" className="journal-screen__button" onClick={() => setDeleteArmed(false)}>
                          やめる
                        </button>
                        <button
                          type="button"
                          className="journal-screen__button journal-screen__button--danger-solid"
                          disabled={busy}
                          onClick={deleteEntry}
                        >
                          本当に削除する
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        className="journal-screen__button journal-screen__button--danger-solid"
                        disabled={busy}
                        onClick={deleteEntry}
                      >
                        この仕訳を削除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
        )}
      </div>
        </>
      )}

      {leaveRequest !== null && (
        <UnsavedChangesDialog saving={busy} onCancel={cancelLeave} onDiscard={discardAndLeave} onSave={() => void saveAndLeave()} />
      )}

      {ruleDialogEntry !== null && derived !== null && (
        <CreateRuleFromEntryDialog
          entry={ruleDialogEntry}
          master={derived.master}
          today={today()}
          onCreate={async (input) => {
            const created = await Promise.resolve(props.recurringTransactionRuleRepository.create(input))
            setData((prev) => (prev === null ? prev : { ...prev, rules: [...prev.rules, created] }))
            setRuleDialogEntry(null)
            setFlash('定期仕訳を作成しました')
            onProposalsChanged?.()
          }}
          onCancel={() => setRuleDialogEntry(null)}
          onCreateBatch={createBatch}
          onRequestCreateCounterparty={(apply) => setCounterpartyDialog({ apply })}
          onRequestCreateProject={(apply) => setProjectDialog({ apply })}
          onRequestCreateAccount={(apply) => setAccountDialog({ apply })}
        />
      )}
      {accountDialog && data !== null && (
        <div className="import-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-label="科目を登録" className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={props.accountRepository}
              journalEntryRepository={props.journalEntryRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              initialCategory="expense"
              onCreated={(created) => {
                setData((prev) => (prev === null ? prev : { ...prev, accounts: [...prev.accounts, created] }))
                accountDialog.apply(created.id)
                setAccountDialog(null)
              }}
              onCancel={() => setAccountDialog(null)}
            />
          </div>
        </div>
      )}
      {projectDialog && (
        <QuickCreateDialog
          title="プロジェクトを追加"
          nameLabel="プロジェクト名"
          onSubmit={async (name) => {
            const created = await props.projectRepository.create({ name })
            setData((prev) => (prev === null ? prev : { ...prev, projects: [...prev.projects, created] }))
            projectDialog.apply(created.id)
            setProjectDialog(null)
          }}
          onCancel={() => setProjectDialog(null)}
        />
      )}
      {counterpartyDialog && (
        <QuickCreateDialog
          title="取引先を追加"
          nameLabel="取引先名"
          onSubmit={async (name) => {
            const created = await counterpartyRepository.create({ name })
            setData((prev) => (prev === null ? prev : { ...prev, counterparties: [...prev.counterparties, created] }))
            counterpartyDialog.apply(created.id)
            setCounterpartyDialog(null)
          }}
          onCancel={() => setCounterpartyDialog(null)}
        />
      )}
    </div>
  )
}
