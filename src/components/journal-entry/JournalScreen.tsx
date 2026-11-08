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
import type { JournalEntry } from '../../domain/journal/JournalEntry'
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
import type { RecurringTransactionProposalRpcApi } from '../../infrastructure/rpc/createRecurringTransactionProposalApi'
import type { JournalEntryDraftRpcApi } from '../../infrastructure/rpc/createRepositoryRegistry'
import { RecurringTransactionHouseholdMemberRequiredError } from '../../domain/recurring-transaction/RecurringTransactionHouseholdMemberRequiredError'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { JournalFilterPanel, type JournalFilterOptions } from '../common/journal-filter/JournalFilterPanel'
import { JournalResultList } from '../common/journal-result/JournalResultList'
import { SOURCE_TAGS, DRAFT_TAG, type JournalResultItem } from '../common/journal-result/journalResultModel'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import type { MaybeAsync } from '../master/maybeAsync'
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
  matchedAccountIdsOf,
  pickSelectionAfterDelete,
  sortProposalsOldestFirst,
  toMatchedResultItem,
} from './journalScreenModel'
import { RelatedEntriesSection } from './RelatedEntriesSection'
import './JournalScreen.css'

export type JournalScreenTab = 'list' | 'drafts' | 'proposals'

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
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll' | 'create'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<Pick<SettlementBatchRepository, 'findAll' | 'create'>>
  recurringTransactionProposalApi: MaybeAsync<Pick<RecurringTransactionProposalRpcApi, 'listPending' | 'confirm' | 'skip'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll'>>
  /** 「この仕訳を割勘」を押したときの移動(割勘の入力フォームへ) */
  onSplit: (entry: JournalEntry) => void
  /** 提案を確定・見送りしたとき(サイドナビのバッジの件数を取り直すため) */
  onProposalsChanged?: () => void
  initialTab?: JournalScreenTab
  /** 最初に選ぶ仕訳(割勘の履歴などから開くとき) */
  initialEntryId?: number
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
  proposals: { ruleId: number; dueDate: string }[]
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
  dueDate: string
  rule: RecurringTransactionRule
}

const today = () => new Date().toISOString().slice(0, 10)

function inactiveIds(items: ReadonlyArray<{ id: number; isActive: boolean }>): Set<number> {
  return new Set(items.filter((i) => !i.isActive).map((i) => i.id))
}

/**
 * 仕訳画面(計画Issue #152)。絞り込み・結果一覧・詳細を1画面にまとめ、「仕訳一覧」「下書き」
 * 「定期の確認」の3つのタブが同じ詳細パネルを使う。確定済みの仕訳は編集・削除・割勘への移動、
 * 下書きは貸借が合わなくても保存でき完成すれば確定、定期取引の提案は金額を直して確定か「今回は見送る」
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
  const [filter, setFilter] = useState<JournalEntryFilter>({})
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editor, setEditor] = useState<JournalEditorValue | null>(null)
  const [flash, setFlash] = useState('')
  const [error, setError] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [proposalMemberId, setProposalMemberId] = useState<number | ''>('')
  const [counterpartyDialog, setCounterpartyDialog] = useState<{ apply: (id: number) => void } | null>(null)
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
      return rule === undefined ? [] : [{ id: index + 1, ruleId: p.ruleId, dueDate: p.dueDate, rule }]
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

  const emptyLines = () =>
    withKeys([
      { ...createEmptyJournalEntryFormLine(), side: 'debit' },
      { ...createEmptyJournalEntryFormLine(), side: 'credit' },
    ])

  function buildValue(sel: Selection, d: LoadedData): JournalEditorValue | null {
    const firstMember = d.members.find((m) => m.isActive)?.id ?? null
    if (sel.kind === 'new') {
      return { entryDate: today(), memo: '', comment: '', householdMemberId: firstMember, lines: emptyLines() }
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
      return {
        entryDate: draft.entryDate ?? today(),
        memo: draft.memo ?? '',
        comment: draft.comment ?? '',
        householdMemberId: draft.householdMemberId ?? firstMember,
        lines: draft.lines.length > 0 ? withKeys(draft.lines.map(fromJournalEntryDraftLine)) : emptyLines(),
      }
    }
    const rule = d.rules.find((r) => r.id === sel.ruleId)
    if (rule === undefined) return null
    const accountById = new Map(d.accounts.map((a) => [a.id, a]))
    const side = (accountId: number, s: 'debit' | 'credit'): JournalEntryFormLine => {
      const account = accountById.get(accountId)
      return {
        accountId,
        side: s,
        amountInput: String(rule.amount),
        projectId: rule.projectId,
        householdMemberId: rule.householdMemberId,
        counterpartyId: account !== undefined && isCounterpartyEligibleCategory(account.category) ? rule.counterpartyId : null,
      }
    }
    return {
      entryDate: sel.dueDate,
      memo: rule.name,
      comment: '',
      householdMemberId: rule.householdMemberId,
      lines: withKeys([side(rule.debitAccountId, 'debit'), side(rule.creditAccountId, 'credit')]),
    }
  }

  function open(sel: Selection | null, d: LoadedData) {
    setFlash('')
    setError('')
    setDeleteArmed(false)
    setProposalMemberId('')
    setSelection(sel)
    setEditor(sel === null ? null : buildValue(sel, d))
  }

  const firstOf = (which: JournalScreenTab, d: LoadedData, entries: JournalEntry[]): Selection | null => {
    if (which === 'list') return entries[0] ? { kind: 'entry', id: entries[0].id } : null
    if (which === 'drafts') {
      const first = [...d.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0]
      return first ? { kind: 'draft', id: first.id } : null
    }
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

  if (data === null || derived === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const { accountNameOf, master, filterOptions, relatedIdsByEntryId, proposalRows } = derived

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

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await action()
    } catch (err) {
      setError(mapError(err, fallback))
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
        await journalEntryRepository.update((selection as { id: number }).id, common)
        savedId = (selection as { id: number }).id
      }
      await reloadAndOpen(
        () => (andNew ? { kind: 'new' } : { kind: 'entry', id: savedId }),
        andNew ? '保存しました。続けて入力できます' : '保存しました',
      )
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
      if (validatedLines() === null) return
      const amount = Number(editor.lines.find((l) => l.line.side === 'debit')?.line.amountInput)
      const memberId = selectedProposal.rule.householdMemberId === null ? proposalMemberId : ''
      await Promise.resolve().then(() =>
        recurringTransactionProposalApi.confirm({
          ruleId: selectedProposal.ruleId,
          dueDate: selectedProposal.dueDate,
          amount,
          householdMemberId: memberId === '' ? undefined : memberId,
        }),
      )
      await afterProposal('仕訳を確定しました')
    }, t('confirmError'))

  const skipProposal = () =>
    run(async () => {
      if (selectedProposal === undefined) return
      await Promise.resolve().then(() =>
        recurringTransactionProposalApi.skip({ ruleId: selectedProposal.ruleId, dueDate: selectedProposal.dueDate }),
      )
      await afterProposal('この回を見送りました。仕訳は作られません')
    }, t('updateError'))

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
    amount: p.rule.amount,
    currency: 'JPY',
    entryDate: p.dueDate,
    debitSummary: accountNameOf(p.rule.debitAccountId),
    creditSummary: accountNameOf(p.rule.creditAccountId),
  }))

  const switchTab = (next: JournalScreenTab) => {
    setTab(next)
    open(firstOf(next, data, visibleEntries), data)
  }

  const tabs: { key: JournalScreenTab; label: string }[] = [
    { key: 'list', label: '仕訳一覧' },
    { key: 'drafts', label: `下書き ${data.drafts.length}` },
    { key: 'proposals', label: `定期の確認 ${proposalRows.length}` },
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

  const incompleteReason = editor === null ? null : findIncompleteReason(lineInputs())
  const stagedReason = (() => {
    if (selection?.kind === 'proposal') {
      if (proposalBlocked) return '先に同じルールの古い提案を確定するか見送ってください'
      if (selectedProposal?.rule.householdMemberId === null && proposalMemberId === '') return '起票者を選んでください'
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
          ? `定期取引の提案: ${selectedProposal?.rule.name ?? ''}`
          : editor?.memo
            ? `仕訳の詳細: ${editor.memo}`
            : '仕訳の詳細'

  const note =
    tab === 'proposals'
      ? '定期取引のルールから作られた提案です。確定すると仕訳になります。不要な回は見送れます。同じルールの提案は古い順に処理します。'
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
          onClick={() => {
            setTab('list')
            open({ kind: 'new' }, data)
          }}
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

      {tab === 'list' && (
        <div className="journal-screen__filter">
          <JournalFilterPanel filter={filter} onChange={setFilter} options={filterOptions} resultCount={visibleEntries.length} />
        </div>
      )}
      {note !== '' && <p className="journal-screen__note">{note}</p>}

      <div className="journal-screen__body">
        <div className="journal-screen__list">
          {tab === 'list' && matchedIds !== undefined && (
            <p className="journal-screen__note">科目に一致した明細の金額を表示しています</p>
          )}
          <JournalResultList
            items={tab === 'list' ? listItems : tab === 'drafts' ? draftItems : proposalItems}
            selectionMode="single"
            selectedIds={selectedIds}
            onSelectionChange={(ids) => {
              const id = ids[0]
              if (id === undefined) return
              if (tab === 'list') open({ kind: 'entry', id }, data)
              else if (tab === 'drafts') open({ kind: 'draft', id }, data)
              else {
                const row = proposalRows.find((p) => p.id === id)
                if (row) open({ kind: 'proposal', ruleId: row.ruleId, dueDate: row.dueDate }, data)
              }
            }}
          />
        </div>

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
                readOnlyLines={selection.kind === 'proposal'}
                onCreateBatch={async (name) => {
                  const created = await settlementBatchRepository.create({ name, type: 'expense_splitting' })
                  setData((prev) => (prev === null ? prev : { ...prev, batches: [...prev.batches, created] }))
                  return created
                }}
                onRequestCreateCounterparty={(apply) => setCounterpartyDialog({ apply })}
              />

              {selection.kind === 'proposal' && selectedProposal?.rule.householdMemberId === null && (
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
                    <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void saveEntry(true)}>
                      保存して続けて入力
                    </button>
                  </>
                )}
                {selection.kind === 'new' && (
                  <button type="button" className="journal-screen__button" disabled={busy} onClick={() => void saveDraft('new')}>
                    下書きに保存
                  </button>
                )}
                {selection.kind === 'entry' && split !== null && (
                  <>
                    <button
                      type="button"
                      className="journal-screen__button"
                      disabled={!split.splittable}
                      aria-describedby="journal-split-reason"
                      onClick={() => selectedEntry && onSplit(selectedEntry)}
                    >
                      この仕訳を割勘
                    </button>
                    <span id="journal-split-reason" className="journal-screen__note">
                      {split.splittable ? '' : describeSplitBlock(split.reason)}
                    </span>
                    <span className="journal-screen__spacer" />
                    <button type="button" className="journal-screen__button journal-screen__button--danger" disabled={busy} onClick={deleteEntry}>
                      {deleteArmed ? '本当に削除する' : '削除'}
                    </button>
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
                      確定
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
              {deleteArmed && selection.kind === 'entry' && (
                <div role="alert" className="journal-screen__delete-box">
                  <div className="journal-screen__delete-title">この仕訳を削除します。元に戻せません。</div>
                  {deleteNotes.map((note) => (
                    <div key={note}>{note}</div>
                  ))}
                  <div className="journal-screen__delete-actions">
                    <button type="button" className="journal-screen__button" onClick={() => setDeleteArmed(false)}>
                      やめる
                    </button>
                  </div>
                </div>
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
                  onOpenEntry={(entry) => {
                    setTab('list')
                    open({ kind: 'entry', id: entry.id }, data)
                  }}
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
            </>
          )}
        </section>
      </div>

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
