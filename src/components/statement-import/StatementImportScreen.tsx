import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Counterparty, CounterpartyPattern } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import { previewImportReconciliation, type ImportPreviewLine, type ImportPreviewRef } from '../../domain/reconciliation/previewImportReconciliation'
import type { ExternalTransactionRef } from '../../domain/reconciliation/ExternalTransactionRef'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import { buildConfirmedJournalEntryInput } from '../../domain/statement-import/buildConfirmedJournalEntryInput'
import { buildStatementImportReview, type StatementImportReviewResult } from '../../domain/statement-import/buildStatementImportReview'
import { collectUnreferencedTransactions } from '../../domain/statement-import/collectUnreferencedTransactions'
import type { ApproximateDuplicateSearchOptions } from '../../domain/statement-import/duplicateDetection'
import { estimateCounterparty, normalizeDescriptionForMatching, type CounterpartyPatternLookup } from '../../domain/statement-import/estimateCounterparty'
import { resolveMappingDefinitionCandidates, type MappingDefinitionCandidateMatch } from '../../domain/statement-import/resolveMappingDefinitionCandidates'
import { suggestCounterpartyAccount, type CounterpartyLookup } from '../../domain/statement-import/suggestCounterpartyAccount'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { AccountBalanceRecordRepository } from '../../domain/reconciliation/AccountBalanceRecordRepository'
import { AccountCreateForm } from '../master/AccountCreateForm'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import type { MappingForm } from '../master/mappingForm'
import type { MaybeAsync } from '../master/maybeAsync'
import { isStatementImportEligibleAccount, isStatementImportCounterAccountEligible } from './statementImportEligibility'
import {
  applyBulkSetting,
  createInitialRowState,
  defaultMemberIdOf,
  isRowEdited,
  isTaggableAccountId,
  resolveEligibleCounterpartyId,
  rowStatus,
  shouldOfferLearn,
  withCounterAccount,
  type ApproximateDecision,
  type BulkChange,
  type ImportRowState,
} from './importRowModel'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { collectFinancialInstitutionNames } from '../../domain/statement-import/financialInstitution'
import { MappingCreateDialog } from './MappingCreateDialog'
import { CounterpartySettingsPopup } from './CounterpartySettingsPopup'
import { applyCounterpartyDraftToRows } from './applyCounterpartyDraftToRows'
import {
  countRowsContaining,
  createCounterpartyDraft,
  isDraftDirty,
  isDraftValid,
  planDraftSave,
  type CounterpartyDraft,
} from './counterpartyDraftModel'
import { mappingFormToInput } from '../master/mappingForm'
import { QuickCreateDialog } from './QuickCreateDialog'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import './StatementImportScreen.css'

/**
 * 確定版候補(近似重複)探索の既定閾値。金融機関によって速報/確定のズレ方が異なるため
 * ドメイン層では規定されていない(docs/domain/statement-import.md 1.6)。日付は2週間、
 * 金額は1,000円までの差を許容する保守的な既定値とする。
 */
const DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS: ApproximateDuplicateSearchOptions = {
  maxDateDiffDays: 14,
  maxAmountDiff: 1000,
}

export interface StatementImportScreenProps {
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll' | 'create'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  importMappingDefinitionRepository: MaybeAsync<
    Pick<ImportMappingDefinitionRepository, 'findAll' | 'create' | 'linkAccount'>
  >
  externalTransactionRefRepository: { findByAccount(accountId: number): ExternalTransactionRef[] | Promise<ExternalTransactionRef[]> }
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll' | 'create' | 'delete'>>
  /** 科目の登録フォームで最初の残高を記録する先(計画Issue #205)。省略時は最初の残高の欄を出さない */
  accountBalanceRecordRepository?: MaybeAsync<Pick<AccountBalanceRecordRepository, 'create'>>
  counterpartyRepository: MaybeAsync<
    Pick<
      CounterpartyRepository,
      | 'findAll'
      | 'findByPattern'
      | 'addPattern'
      | 'create'
      | 'update'
      | 'findPatternsByCounterparty'
      | 'updatePattern'
      | 'deletePattern'
    >
  >
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll' | 'create'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<Pick<SettlementBatchRepository, 'findAll'>>
  /** 「マッピングを編集」を押したときの移動(マスタの明細マッピングタブへ) */
  onEditMappings: () => void
  /** テスト用に近似重複判定の閾値を注入できる */
  approximateDuplicateOptions?: ApproximateDuplicateSearchOptions
}

interface LoadedData {
  accounts: Account[]
  accountGroups: AccountGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  members: HouseholdMember[]
  batches: SettlementBatch[]
}

/** 取り込んだCSV1回分。確定するまで画面の状態としてだけ持つ(ドラフト保存は使わない) */
interface ImportSession {
  fileName: string
  targetAccount: Account
  definition: ImportMappingDefinition
  review: StatementImportReviewResult
  rows: ImportRowState[]
  /** 取り込んだ直後の行の状態。編集したか(未保存の警告)の判定に使う */
  initialRows: ImportRowState[]
  /** 確定済みで一覧から外した行 */
  done: Set<number>
}

type CreateTarget =
  | { kind: 'counterAccount' | 'counterparty' | 'project' | 'targetAccount'; apply: (id: number) => void }
  | null

/** 取込画面で選んだCSV。定義の作成ダイアログや、文字コードの違う定義での読み直しに元のバイト列を持つ */
interface LoadedCsv {
  fileName: string
  bytes: Uint8Array
}

interface ConfirmFailure {
  index: number
  message: string
}

/**
 * 明細取込画面(計画Issue #151)。旧アップロード画面とレビュー画面を1画面にまとめ、取込先とCSVを
 * 選ぶと同じ画面に1件1行で並べる。取引先の推定・相手科目のサジェスト・重複防止・確定版の候補・
 * 残高照合(docs/domain/statement-import.md 1.5・1.6)は従来どおり。選んだ行へ一括設定でき、
 * 確定すると取込先とマッピング定義の紐づけを追加し、続けて次のCSVを取り込める。
 * CSVのパースはメインスレッドで行う(docs/architecture.md 12章)。
 */
export function StatementImportScreen(props: StatementImportScreenProps) {
  const {
    accountRepository,
    accountGroupRepository,
    importMappingDefinitionRepository,
    externalTransactionRefRepository,
    journalEntryRepository,
    accountBalanceRecordRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
    onEditMappings,
    approximateDuplicateOptions,
  } = props
  const { t } = useTranslation('statementImport')
  const { t: tCommon } = useTranslation('common')
  const { t: tMaster } = useTranslation('master')

  const [data, setData] = useState<LoadedData | null>(null)
  const [csv, setCsv] = useState<LoadedCsv | null>(null)
  /** 実パースが通った定義の候補(2件以上のときだけ表示名で選ばせる) */
  const [candidates, setCandidates] = useState<MappingDefinitionCandidateMatch[]>([])
  const [match, setMatch] = useState<MappingDefinitionCandidateMatch | null>(null)
  const [noMatch, setNoMatch] = useState(false)
  const [showMappingDialog, setShowMappingDialog] = useState(false)
  const [institutionNames, setInstitutionNames] = useState<string[]>([])
  /** 科目の新規追加フォームで紐づけ先に選べる、全マッピング定義(計画Issue #189) */
  const [allDefinitions, setAllDefinitions] = useState<ImportMappingDefinition[]>([])
  const [targetAccountId, setTargetAccountId] = useState<number | null>(null)
  const [session, setSession] = useState<ImportSession | null>(null)
  /** 名義の無い科目で選んだ「誰の明細か」。どの科目で選んだかを持ち、科目が変わったら無効になる */
  const [ownerChoice, setOwnerChoice] = useState<{ accountId: number; memberId: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkComment, setBulkComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [doneMessage, setDoneMessage] = useState('')
  const [failures, setFailures] = useState<ConfirmFailure[]>([])
  const [createTarget, setCreateTarget] = useState<CreateTarget>(null)
  const [quickAddedCounterpartyIds, setQuickAddedCounterpartyIds] = useState<Set<number>>(new Set())
  /** 取引先ごとの「取引先の設定」の下書き(計画Issue #207)。確定するまでDBには書かない */
  const [drafts, setDrafts] = useState<Map<number, CounterpartyDraft>>(new Map())
  /** 「取引先の設定」を開いている行 */
  const [openSettings, setOpenSettings] = useState<number | null>(null)
  /** 「ほかの行にも適用」を押した結果(開いているポップアップに出す) */
  const [settingsMessage, setSettingsMessage] = useState('')
  /** 残高の照合に使う、取込先の既存の明細行と突合マスタ(計画Issue #205) */
  const [pastData, setPastData] = useState<{ lines: ImportPreviewLine[]; refs: ImportPreviewRef[] } | null>(null)

  useEffect(() => {
    void (async () => {
      const [accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members, batches] =
        await Promise.all([
          accountRepository.findAll(),
          accountGroupRepository.findAll(),
          counterpartyRepository.findAll(),
          counterpartyGroupRepository.findAll(),
          projectRepository.findAll(),
          projectGroupRepository.findAll(),
          householdMemberRepository.findAll(),
          settlementBatchRepository.findAll(),
        ])
      setData({ accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members, batches })
    })()
  }, [
    accountRepository,
    accountGroupRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
  ])

  const targetAccount = data?.accounts.find((a) => a.id === targetAccountId) ?? null
  /**
   * 誰の明細か(計画Issue #193)。科目に名義があればそれが絶対(変更不可)。無ければ利用者が選んだ人で、
   * 未選択なら null のまま(先頭メンバーへ黙ってフォールバックしない)。科目を変えると選び直しになる
   */
  const statementOwnerId = targetAccount
    ? (targetAccount.householdMemberId ?? (ownerChoice?.accountId === targetAccount.id ? ownerChoice.memberId : null))
    : null
  const hasStatementBalance = session?.review.records.some((r) => r.record.balanceAfter !== null) ?? false

  // 残高の照合に使う、取込先の既存の明細行と突合マスタ(計画Issue #205)
  useEffect(() => {
    if (!session || session.targetAccount.isReconcilable !== true || !hasStatementBalance) {
      setPastData(null)
      return
    }
    const accountId = session.targetAccount.id
    void Promise.all([
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(externalTransactionRefRepository.findByAccount(accountId)),
    ]).then(([all, refs]: [JournalEntry[], ExternalTransactionRef[]]) =>
      setPastData({
        lines: all.flatMap((entry) =>
          entry.lines
            .filter((line) => line.accountId === accountId)
            .map((line) => ({
              journalEntryId: line.journalEntryId,
              entryDate: entry.entryDate,
              side: line.side,
              amount: line.amount,
              sourceType: entry.sourceType,
            })),
        ),
        refs: refs.map((ref) => ({
          id: ref.id,
          journalEntryId: ref.journalEntryId,
          entryDate: ref.entryDate,
          amount: ref.amount,
          externalBalanceAfter: ref.externalBalanceAfter,
          rowOrder: ref.rowOrder,
          importedAt: ref.importedAt,
        })),
      }),
    )
  }, [session?.targetAccount.id, session?.targetAccount.isReconcilable, hasStatementBalance, journalEntryRepository, externalTransactionRefRepository]) // eslint-disable-line react-hooks/exhaustive-deps

  // 未保存の警告(計画Issue #193)。取り込んだ行の入力を初期状態から変えて、まだ確定していないとき。
  // 「保存して移動」は、確定できる行を確定する(確定できない行が残るときは移動しない)
  // 取引先の設定の下書き(パターンの編集・追加・削除、相手科目の初期値)があるときも未保存の編集とする(計画Issue #207)
  const hasDirtyDraft = [...drafts.values()].some(isDraftDirty)
  const hasInvalidDraft = [...drafts.values()].some((draft) => isDraftDirty(draft) && !isDraftValid(draft))
  const hasUnsavedEdits =
    session !== null &&
    (hasDirtyDraft ||
      session.rows.some((state, index) => !session.done.has(index) && isRowEdited(state, session.initialRows[index])))
  const unsavedDialog = useUnsavedEditGuard({ dirty: hasUnsavedEdits, save: () => handleConfirm() })
  const guarded = useGuardedAction()

  const categories = useMemo(() => {
    if (!data) return null
    const inactive = (items: ReadonlyArray<{ id: number; isActive: boolean }>) =>
      new Set(items.filter((i) => !i.isActive).map((i) => i.id))
    const counterAccounts = data.accounts.filter(
      (a) => a.id !== targetAccount?.id && isStatementImportCounterAccountEligible(a),
    )
    return {
      counterAccounts: buildTreeSelectCategories(
        buildAccountTree({ groups: data.accountGroups, accounts: counterAccounts, memberNameById: new Map() }),
        inactive(counterAccounts),
      ).filter((c) => c.nodes.length > 0),
      counterparties: buildTreeSelectCategories(
        buildCounterpartyTree({
          groups: data.counterpartyGroups,
          counterparties: data.counterparties,
          accountNameById: new Map(),
          patternCountById: new Map(),
        }),
        inactive(data.counterparties),
      ),
      projects: buildTreeSelectCategories(
        buildProjectTree({ groups: data.projectGroups, projects: data.projects }),
        inactive(data.projects),
      ),
      counterAccountList: counterAccounts,
      // 取引先の設定で相手科目の初期値に選べるのは、取引先を持てる費用・収益の科目だけ(計画Issue #207)
      defaultAccounts: buildTreeSelectCategories(
        buildAccountTree({
          groups: data.accountGroups,
          accounts: counterAccounts.filter((a) => isCounterpartyEligibleCategory(a.category)),
          memberNameById: new Map(),
        }),
        inactive(counterAccounts),
      ).filter((c) => c.nodes.length > 0),
    }
  }, [data, targetAccount?.id])

  if (data === null || categories === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const eligibleTargets = data.accounts.filter(isStatementImportEligibleAccount)
  const accountList = categories.counterAccountList
  const counterpartyLookup: CounterpartyLookup = {
    findById: (id) => data.counterparties.find((c) => c.id === id) ?? null,
  }

  const updateRow = (index: number, update: (state: ImportRowState) => ImportRowState) =>
    setSession((prev) =>
      prev === null ? prev : { ...prev, rows: prev.rows.map((state, i) => (i === index ? update(state) : state)) },
    )

  /**
   * 「取引先の設定」を開く(計画Issue #207)。取引先の下書きが無ければ、登録済みパターンを読み込んで作る。
   * 推定と違う取引先を選んだ行(パターン登録の候補)なら、その行の摘要を新しいパターンの初期値に入れる。
   * 曖昧で決まらなかった行と、すでに登録済みのパターンが摘要に含まれる行は、新しいパターンを入れない。
   */
  async function toggleSettings(index: number) {
    if (!session) return
    if (openSettings === index) {
      setOpenSettings(null)
      return
    }
    setOpenSettings(index)
    setSettingsMessage('')
    const state = session.rows[index]
    const counterpartyId = state.counterpartyId
    if (counterpartyId === null || drafts.has(counterpartyId)) return
    const registered = await Promise.resolve(counterpartyRepository.findPatternsByCounterparty(counterpartyId))
    const description = records[index].record.description
    const offerSeed =
      shouldOfferLearn(records[index], state) &&
      state.candidateCounterpartyIds.length < 2 &&
      !registered.some((p) => countRowsContaining(p.pattern, [description]) > 0)
    const counterparty = data!.counterparties.find((c) => c.id === counterpartyId)
    setDrafts((prev) =>
      prev.has(counterpartyId)
        ? prev
        : new Map(prev).set(
            counterpartyId,
            createCounterpartyDraft({
              counterpartyId,
              defaultAccountId: counterparty?.defaultAccountId ?? null,
              registered: registered.map((p) => ({ id: p.id, pattern: p.pattern })),
              initialNewPattern: offerSeed ? { text: description.trim(), sourceDescription: description } : null,
            }),
          ),
    )
  }

  /** 「ほかの行にも適用」。取引先の下書きを、取り込み中のほかの行へ画面上だけで反映する(DBには書かない) */
  function applySettingsToOtherRows(draft: CounterpartyDraft) {
    if (!session) return
    const result = applyCounterpartyDraftToRows({
      states: session.rows,
      initialStates: session.initialRows,
      records,
      descriptions: records.map((r) => r.record.description),
      done: session.done,
      draft,
      accounts: accountList,
    })
    setSession({ ...session, rows: result.states, initialRows: result.initialStates })
    setSettingsMessage(result.applied > 0 ? t('applyDone', { count: result.applied }) : t('applyNone'))
  }

  /** 取引先推定と相手科目のサジェストで、各行の初期値を作る(docs/domain/statement-import.md 1.5手順4・5) */
  async function computeInitialRows(
    review: StatementImportReviewResult,
    counterparties: readonly Counterparty[],
    accounts: readonly Account[],
  ): Promise<ImportRowState[]> {
    const normalizedList = [...new Set(review.records.map((r) => normalizeDescriptionForMatching(r.record.description)))]
    const patternsByText = new Map<string, CounterpartyPattern[]>(
      await Promise.all(
        normalizedList.map(async (text) => [text, await Promise.resolve(counterpartyRepository.findByPattern(text))] as const),
      ),
    )
    const patternLookup: CounterpartyPatternLookup = { findByPattern: (text) => patternsByText.get(text) ?? [] }
    const lookup: CounterpartyLookup = { findById: (id) => counterparties.find((c) => c.id === id) ?? null }
    return review.records.map((r) => {
      const counterpartyId = estimateCounterparty(r.record.description, patternLookup)
      const counterAccountId = suggestCounterpartyAccount(counterpartyId, lookup)
      const candidates = [
        ...new Set(
          (patternsByText.get(normalizeDescriptionForMatching(r.record.description)) ?? []).map((p) => p.counterpartyId),
        ),
      ]
      return createInitialRowState({
        counterpartyId: resolveEligibleCounterpartyId(counterpartyId, counterAccountId, accounts),
        counterAccountId,
        candidateCounterpartyIds: counterpartyId === null ? candidates : [],
      })
    })
  }

  async function buildSession(account: Account, fileName: string, match: MappingDefinitionCandidateMatch) {
    const existingRefs = await Promise.resolve(externalTransactionRefRepository.findByAccount(account.id))
    // 手入力・定期仕訳生成など突合マスタを持たない仕訳も確定版候補に含める(計画Issue #145)
    const all = await Promise.resolve(journalEntryRepository.findAll())
    const existingTransactions = [
      ...existingRefs.map((ref) => ({
        journalEntryId: ref.journalEntryId,
        entryDate: ref.entryDate,
        amount: ref.amount,
        isSettled: ref.isSettled,
      })),
      ...collectUnreferencedTransactions(all, account, new Set(existingRefs.map((ref) => ref.journalEntryId))),
    ]
    const review = buildStatementImportReview({
      rows: match.rows,
      definition: match.definition,
      existingExternalIds: new Set(existingRefs.map((ref) => ref.externalId)),
      existingTransactions,
      approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
    })
    const rows = await computeInitialRows(review, data!.counterparties, data!.accounts)
    setSession({ fileName, targetAccount: account, definition: match.definition, review, rows, initialRows: rows, done: new Set() })
    setSelected(new Set())
    setBulkMessage('')
    setDrafts(new Map())
    setOpenSettings(null)
    setSettingsMessage('')
  }

  /** 定義が決まったら、紐づく科目(取込先に選べるもの)の先頭を初期値にして取り込む。無ければ選ばせる */
  async function selectMatch(next: MappingDefinitionCandidateMatch, fileName: string) {
    setMatch(next)
    setSession(null)
    const linked = next.definition.accountIds
      .map((id) => data!.accounts.find((a) => a.id === id))
      .filter((a): a is Account => a !== undefined && isStatementImportEligibleAccount(a))
    const initial = linked[0] ?? null
    setTargetAccountId(initial?.id ?? null)
    if (initial) await buildSession(initial, fileName, next)
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setDoneMessage('')
    setFailures([])
    setSession(null)
    setMatch(null)
    setCandidates([])
    setNoMatch(false)
    setTargetAccountId(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      setCsv({ fileName: file.name, bytes })
      // 取込先は定義から決まるので、まず全定義に実際のパースを試して絞り込む
      const definitions = await Promise.resolve(importMappingDefinitionRepository.findAll())
      setInstitutionNames(collectFinancialInstitutionNames(definitions.map((d) => d.formatGroupId)))
      setAllDefinitions(definitions)
      const matches = resolveMappingDefinitionCandidates(bytes, definitions)
      if (matches.length === 0) {
        setNoMatch(true)
      } else if (matches.length === 1) {
        await selectMatch(matches[0], file.name)
      } else {
        setCandidates(matches)
      }
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }

  async function chooseDefinition(definitionId: number) {
    const next = candidates.find((m) => m.definition.id === definitionId)
    if (!next || !csv) return
    setBusy(true)
    try {
      await selectMatch(next, csv.fileName)
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }

  /** 取込先を選び直す。重複・確定版の候補・残高照合は取込先ごとなので、一覧を作り直す */
  async function changeTargetAccount(id: number | null) {
    setTargetAccountId(id)
    setSession(null)
    const account = data!.accounts.find((a) => a.id === id)
    if (!account || !match || !csv) return
    setBusy(true)
    try {
      await buildSession(account, csv.fileName, match)
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }

  /** 画面内で作った定義を保存し、そのまま取り込みに進む */
  async function saveMappingAndContinue(form: MappingForm) {
    if (!csv) return
    const created = await Promise.resolve(importMappingDefinitionRepository.create(mappingFormToInput(form)))
    const matches = resolveMappingDefinitionCandidates(csv.bytes, [created])
    if (matches.length === 0) throw new Error('created mapping does not parse the csv')
    setShowMappingDialog(false)
    setNoMatch(false)
    await selectMatch(matches[0], csv.fileName)
  }

  const records = session?.review.records ?? []
  const visibleIndices = session ? records.map((_, i) => i).filter((i) => !session.done.has(i)) : []
  const statusOf = (i: number) => rowStatus(records[i], session!.rows[i])
  const importable = visibleIndices.filter((i) => statusOf(i) !== 'duplicate')
  const dupCount = visibleIndices.length - importable.length
  const checkCount = visibleIndices.filter((i) => statusOf(i) === 'check').length

  const applyBulk = (change: BulkChange) => {
    if (!session) return
    const result = applyBulkSetting({
      states: session.rows,
      records,
      selected,
      accounts: accountList,
      change,
    })
    setSession({ ...session, rows: result.states })
    setBulkMessage(
      result.skipped > 0
        ? t('bulkAppliedWithSkipped', { count: result.applied, skipped: result.skipped })
        : t('bulkApplied', { count: result.applied }),
    )
  }

  const toggleSelected = (index: number) => {
    setBulkMessage('')
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }
  const allSelected = importable.length > 0 && importable.every((i) => selected.has(i))

  async function createCounterparty(name: string, apply: (id: number) => void) {
    const created = await Promise.resolve(counterpartyRepository.create({ name }))
    setData((prev) => (prev ? { ...prev, counterparties: [...prev.counterparties, created] } : prev))
    setQuickAddedCounterpartyIds((prev) => new Set(prev).add(created.id))
    apply(created.id)
    setCreateTarget(null)
  }

  async function createProject(name: string, apply: (id: number) => void) {
    const created = await Promise.resolve(projectRepository.create({ name }))
    setData((prev) => (prev ? { ...prev, projects: [...prev.projects, created] } : prev))
    apply(created.id)
    setCreateTarget(null)
  }

  /** 確定(docs/domain/statement-import.md 1.5手順7)。1件が失敗しても残りの確定を続ける(継続処理方式) */
  async function handleConfirm(): Promise<boolean> {
    if (!session || statementOwnerId === null || hasInvalidDraft) return false
    setBusy(true)
    setError('')
    setDoneMessage('')
    const account = session.targetAccount
    const deleted = new Set<number>()
    const failed: ConfirmFailure[] = []
    const succeeded = new Set<number>()
    /** 確定に成功した行の取引先(取引先の下書きは、その取引先の行が1件でも確定できたときに保存する) */
    const succeededCounterpartyIds = new Set<number>()
    let learned = 0
    // 同じ取込の行は同じ取込日時にそろえる(残高の基準点の並び順を取込単位で判定するため、計画Issue #205)
    const importedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')

    for (const index of importable) {
      const { record, externalId, approximateCandidates } = records[index]
      const state = session.rows[index]
      if (state.counterAccountId === null) {
        failed.push({ index, message: t('counterAccountRequiredError') })
        continue
      }
      try {
        if (state.approximateDecision === 'confirmed_replacement') {
          for (const candidate of approximateCandidates) {
            if (deleted.has(candidate.journalEntryId)) continue
            await Promise.resolve(journalEntryRepository.delete(candidate.journalEntryId))
            deleted.add(candidate.journalEntryId)
          }
        }
        // 起票者: 「誰の明細か」(科目の名義、無ければ利用者が選んだ人。計画Issue #193)
        const entryHouseholdMemberId = statementOwnerId
        await Promise.resolve(
          journalEntryRepository.create(
            buildConfirmedJournalEntryInput({
              record,
              externalId,
              targetAccountId: account.id,
              targetAccountCategory: account.category,
              counterAccountId: state.counterAccountId,
              counterpartyId: state.counterpartyId,
              projectId: state.projectId,
              householdMemberId: state.householdMemberId,
              settlementBatchId: isTaggableAccountId(state.counterAccountId, accountList) ? state.settlementBatchId : null,
              comment: state.comment,
              rowOrder: index,
              importedAt,
              entryHouseholdMemberId,
              // 明細行の世帯メンバー: 科目の既定メンバー > 相手科目の行に選んだ世帯メンバー > 起票者(計画Issue #169)
              resolveLineHouseholdMemberId: createLineHouseholdMemberResolver([account, ...accountList], entryHouseholdMemberId),
            }),
          ),
        )
        succeeded.add(index)
        if (state.counterpartyId !== null) succeededCounterpartyIds.add(state.counterpartyId)

        // 取引先の設定を開いていない取引先は、従来どおり摘要を新しいパターンとして登録する(計画Issue #207)。
        // 開いたものは、下書きの内容に従ってループの後でまとめて保存する
        if (shouldOfferLearn(records[index], state) && state.counterpartyId !== null && !drafts.has(state.counterpartyId)) {
          // パターンは正規化して保存する。取引先の推定(findByPattern)は正規化した摘要にSQLのLIKEで照合するため、
          // 空白や小文字を含んだまま保存すると、次回以降の推定に当たらない(計画Issue #207)
          const pattern = normalizeDescriptionForMatching(record.description)
          // 摘要だけでは取引先が決まらなかった行は、誤った学習を避けるため登録しない
          if (state.candidateCounterpartyIds.length < 2 && pattern.length > 0) {
            try {
              await Promise.resolve(counterpartyRepository.addPattern(state.counterpartyId, pattern))
              learned++
            } catch {
              // 同じパターンが登録済みなど。確定自体は成功しているので無視する
            }
          }
          // その場で追加した取引先は、この行の相手科目を取引先の既定の科目にする
          if (quickAddedCounterpartyIds.has(state.counterpartyId)) {
            await Promise.resolve(
              counterpartyRepository.update(state.counterpartyId, { defaultAccountId: state.counterAccountId }),
            )
          }
        }
      } catch {
        failed.push({ index, message: t('confirmError') })
      }
    }

    // 取引先の設定の下書きを、その取引先の行が1件でも確定できたものだけ保存する(計画Issue #207)。
    // 削除→更新→追加の順に書く(同じ文字列への付け替えで重複しないため)
    const savedDraftIds = new Set<number>()
    const updatedCounterparties = new Map<number, Counterparty>()
    let draftSaveFailed = false
    for (const draft of drafts.values()) {
      if (!succeededCounterpartyIds.has(draft.counterpartyId) || !isDraftDirty(draft)) continue
      const plan = planDraftSave(draft)
      try {
        for (const id of plan.deletePatternIds) await Promise.resolve(counterpartyRepository.deletePattern(id))
        for (const { id, pattern } of plan.updatePatterns) await Promise.resolve(counterpartyRepository.updatePattern(id, normalizeDescriptionForMatching(pattern)))
        for (const pattern of plan.addPatterns) {
          try {
            await Promise.resolve(counterpartyRepository.addPattern(draft.counterpartyId, normalizeDescriptionForMatching(pattern)))
            learned++
          } catch {
            // 同じパターンが登録済みなど。ほかの保存は続ける
          }
        }
        if (plan.defaultAccountId !== null) {
          const updated = await Promise.resolve(
            counterpartyRepository.update(draft.counterpartyId, { defaultAccountId: plan.defaultAccountId.value }),
          )
          updatedCounterparties.set(draft.counterpartyId, updated)
        }
        savedDraftIds.add(draft.counterpartyId)
      } catch {
        draftSaveFailed = true
      }
    }
    if (savedDraftIds.size > 0) {
      setDrafts((prev) => new Map([...prev].filter(([id]) => !savedDraftIds.has(id))))
      setOpenSettings(null)
    }
    if (updatedCounterparties.size > 0) {
      setData((prev) =>
        prev ? { ...prev, counterparties: prev.counterparties.map((c) => updatedCounterparties.get(c.id) ?? c) } : prev,
      )
    }

    if (succeeded.size > 0) {
      // 選んで取り込んだ定義を、取込先の科目に紐づける(次回から候補の先頭に出る)
      await Promise.resolve(importMappingDefinitionRepository.linkAccount(session.definition.id, account.id))
    }
    setSession({ ...session, done: new Set([...session.done, ...succeeded]) })
    setSelected(new Set())
    setFailures(failed)
    if (draftSaveFailed) setError(t('settingsSaveError'))
    setDoneMessage(
      failed.length === 0
        ? t('confirmDone', { learned: learned > 0 ? t('confirmLearned', { count: learned }) : '' })
        : t('confirmResultSummary', { successCount: succeeded.size, failureCount: failed.length }),
    )
    setBusy(false)
    return failed.length === 0
  }

  // 残高照合(docs/domain/reconciliation.md 1.5)。確定版として置き換える旧仕訳と、取り込まない行は除く
  const replacedIds = new Set(
    visibleIndices.flatMap((i) =>
      session!.rows[i].approximateDecision === 'confirmed_replacement'
        ? records[i].approximateCandidates.map((c) => c.journalEntryId)
        : [],
    ),
  )
  const reconciliation =
    session && session.targetAccount.isReconcilable === true && pastData !== null && hasStatementBalance && importable.length > 0
      ? previewImportReconciliation({
          existingLines: pastData.lines,
          existingRefs: pastData.refs,
          replacedEntryIds: replacedIds,
          newRows: importable.map((i) => ({
            entryDate: records[i].record.entryDate,
            amount: records[i].record.amount,
            balanceAfter: records[i].record.balanceAfter,
            rowOrder: i,
          })),
          autoAdjust: session.targetAccount.autoBalanceAdjustment,
        })
      : null

  const signedYen = (n: number) => `${n < 0 ? '-' : ''}${formatCurrency(Math.abs(n), 'JPY').replace('￥', '¥')}`
  const treeValue = (id: number | null) => (id === null ? '' : String(id))
  const toId = (value: string) => (value === '' ? null : Number(value))
  const activeMembers = data.members

  /** CSVの選択ボタン。編集中は確認を通してからファイル選択を開く(計画Issue #193) */
  const chooseCsvButton = (className: string) => (
    <button type="button" className={className} disabled={busy} onClick={() => guarded(() => fileInputRef.current?.click())}>
      {t('chooseCsv')}
    </button>
  )

  return (
    <div className="import-screen">
      {unsavedDialog}
      <div className="import-screen__head">
        <h1 className="import-screen__title">{t('screenTitle')}</h1>
        <div className="import-screen__controls">
          {csv && chooseCsvButton('import-btn')}
          <button type="button" className="import-btn" onClick={() => guarded(onEditMappings)}>
            {t('editMappings')}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="import-error">{error}</p>}

      <input ref={fileInputRef} type="file" accept=".csv" hidden aria-label={t('chooseCsv')} disabled={busy} onChange={(e) => void handleFile(e)} />
      {!csv && (
        <section aria-label={t('csvStartLabel')} className="import-start">
          {chooseCsvButton('import-btn import-btn--primary import-btn--large')}
          <p className="import-note">{t('csvStartNote')}</p>
        </section>
      )}

      {csv && noMatch && (
        <section role="alert" aria-label={t('noMatchTitle', { fileName: csv.fileName })} className="import-panel">
          <p className="import-panel__title import-error">{t('noMatchTitle', { fileName: csv.fileName })}</p>
          <p className="import-note">{t('noMatchBody')}</p>
          <div className="import-panel__actions">
            <button type="button" className="import-btn import-btn--primary" onClick={() => setShowMappingDialog(true)}>
              {t('createMappingFromCsv')}
            </button>
            <button type="button" className="import-btn" onClick={() => fileInputRef.current?.click()}>
              {t('chooseOtherCsv')}
            </button>
          </div>
        </section>
      )}

      {csv && !noMatch && (candidates.length > 1 || match) && (
        <section aria-label={t('settingsLabel')} className="import-panel">
          <div className="import-panel__row">
            <div className="import-field">
              <span className="import-field__label">CSV</span>
              <span className="import-panel__value">{csv.fileName}</span>
            </div>
            {candidates.length > 1 ? (
              <div className="import-field">
                <label className="import-field__label" htmlFor="import-definition">
                  {t('definitionLabel')}
                </label>
                <select
                  id="import-definition"
                  className="import-control"
                  value={match?.definition.id ?? ''}
                  onChange={(e) => e.target.value !== '' && void chooseDefinition(Number(e.target.value))}
                >
                  <option value="">{t('chooseDefinition')}</option>
                  {candidates.map((m) => (
                    <option key={m.definition.id} value={m.definition.id}>
                      {m.definition.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              match && (
                <div className="import-field">
                  <span className="import-field__label">{t('mappingLabel')}</span>
                  <span className="import-panel__value">{match.definition.label}</span>
                </div>
              )
            )}
            {match && (
              <div className="import-field">
                <label className="import-field__label" htmlFor="import-account">
                  {t('targetAccountLabel')}
                </label>
                <select
                  id="import-account"
                  className={`import-control import-control--wide${targetAccountId === null ? ' import-control--attention' : ''}`}
                  value={targetAccountId ?? ''}
                  onChange={(e) => void changeTargetAccount(toId(e.target.value))}
                >
                  <option value="">{t('chooseDefinition')}</option>
                  {(() => {
                    const linkedIds = new Set(match.definition.accountIds)
                    const linked = eligibleTargets.filter((a) => linkedIds.has(a.id))
                    const others = eligibleTargets.filter((a) => !linkedIds.has(a.id))
                    const option = (a: Account) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    )
                    return linked.length > 0 ? (
                      <>
                        <optgroup label={t('accountGroupLinked')}>{linked.map(option)}</optgroup>
                        {others.length > 0 && <optgroup label={t('accountGroupOther')}>{others.map(option)}</optgroup>}
                      </>
                    ) : (
                      eligibleTargets.map(option)
                    )
                  })()}
                </select>
              </div>
            )}
            {match && targetAccount && (
              <div className="import-field">
                {targetAccount.householdMemberId !== null ? (
                  <>
                    <span className="import-field__label">{t('statementOwnerReadOnlyLabel')}</span>
                    <span className="import-panel__value">
                      {t('statementOwnerFromAccount', {
                        name: data.members.find((m) => m.id === targetAccount.householdMemberId)?.name ?? '',
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <label className="import-field__label" htmlFor="import-owner">
                      {t('statementOwnerLabel')}
                    </label>
                    <select
                      id="import-owner"
                      className={`import-control${statementOwnerId === null ? ' import-control--attention' : ''}`}
                      value={statementOwnerId ?? ''}
                      onChange={(e) =>
                        setOwnerChoice(e.target.value === '' ? null : { accountId: targetAccount.id, memberId: Number(e.target.value) })
                      }
                    >
                      <option value="">{t('statementOwnerPlaceholder')}</option>
                      {data.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
            {match && match.definition.accountIds.length === 0 && (
              <button
                type="button"
                className="import-btn"
                onClick={() => setCreateTarget({ kind: 'targetAccount', apply: (id) => void changeTargetAccount(id) })}
              >
                {t('addTargetAccount')}
              </button>
            )}
          </div>
          {match && targetAccount && (
            <p className={`import-note${targetAccount.householdMemberId === null && statementOwnerId === null ? ' import-error' : ''}`}>
              {targetAccount.householdMemberId !== null
                ? t('statementOwnerHintFixed', { name: data.members.find((m) => m.id === targetAccount.householdMemberId)?.name ?? '' })
                : t('statementOwnerHintRequired')}
            </p>
          )}
          {match && (
            <p className="import-note">
              {match.definition.accountIds.length > 0
                ? t('accountLinkedNote', {
                    accounts: match.definition.accountIds
                      .map((id) => data.accounts.find((a) => a.id === id)?.name)
                      .filter(Boolean)
                      .map((name) => `「${name}」`)
                      .join(''),
                  })
                : t('accountUnlinkedNote')}
            </p>
          )}
        </section>
      )}

      {csv && match && targetAccountId === null && !noMatch && (
        <p className="import-empty">{t('pickAccountPrompt')}</p>
      )}

      {session && visibleIndices.length > 0 && (
        <>
          <p className="import-summary">
            {t('loadedSummary', { fileName: session.fileName, newCount: importable.length, dupCount, checkCount })}
          </p>

          {reconciliation && reconciliation.gaps.length === 0 && (
            <p role="status" className="import-summary">
              {t('balanceReconciled')}
            </p>
          )}
          {reconciliation && reconciliation.gaps.length > 0 && (
            <div role="alert" className="import-error">
              <p>{t(reconciliation.adjusted ? 'balanceGapAdjusted' : 'balanceGapNotAdjusted')}</p>
              <ul>
                {reconciliation.gaps.slice(0, 5).map((gap) => (
                  <li key={gap.periodEnd}>
                    {t('balanceGapItem', {
                      period: `${gap.periodStart}〜${gap.periodEnd}`,
                      amount: signedYen(gap.amount),
                    })}
                  </li>
                ))}
                {reconciliation.gaps.length > 5 && <li>{t('balanceGapMore', { count: reconciliation.gaps.length - 5 })}</li>}
              </ul>
            </div>
          )}

          {selected.size > 0 && (
            <div role="group" aria-label={t('bulkGroup')} className="import-bulk">
              <span className="import-bulk__count">{t('bulkCount', { count: selected.size })}</span>
              <TreeSelect
                label={t('bulkCounterAccount')}
                categories={categories.counterAccounts}
                value=""
                placeholder={t('bulkCounterAccountPlaceholder')}
                onChange={(v) => v !== '' && applyBulk({ field: 'counterAccount', value: Number(v) })}
                onCreate={() =>
                  setCreateTarget({ kind: 'counterAccount', apply: (id) => applyBulk({ field: 'counterAccount', value: id }) })
                }
                createLabel={t('createCounterAccount')}
              />
              <TreeSelect
                label={t('bulkCounterparty')}
                categories={categories.counterparties}
                value=""
                emptyLabel={t('bulkClear')}
                placeholder={t('bulkCounterpartyPlaceholder')}
                onChange={(v) => applyBulk({ field: 'counterparty', value: toId(v) })}
              />
              <TreeSelect
                label={t('bulkProject')}
                categories={categories.projects}
                value=""
                emptyLabel={t('bulkClear')}
                placeholder={t('bulkProjectPlaceholder')}
                onChange={(v) => applyBulk({ field: 'project', value: toId(v) })}
              />
              <select
                className="import-control import-control--small"
                aria-label={t('bulkMember')}
                value=""
                onChange={(e) => e.target.value !== '' && applyBulk({ field: 'householdMember', value: e.target.value === 'none' ? null : Number(e.target.value) })}
              >
                <option value="">{t('bulkMemberPlaceholder')}</option>
                <option value="none">{t('bulkClear')}</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select
                className="import-control import-control--small"
                aria-label={t('bulkBatch')}
                value=""
                onChange={(e) => e.target.value !== '' && applyBulk({ field: 'settlementBatch', value: e.target.value === 'none' ? null : Number(e.target.value) })}
              >
                <option value="">{t('bulkBatchPlaceholder')}</option>
                <option value="none">{t('bulkClear')}</option>
                {data.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input
                className="import-control import-control--small"
                aria-label={t('bulkCommentLabel')}
                placeholder={t('commentPlaceholder')}
                value={bulkComment}
                onChange={(e) => setBulkComment(e.target.value)}
              />
              <button type="button" className="import-btn import-btn--small" onClick={() => applyBulk({ field: 'comment', value: bulkComment })}>
                {t('bulkCommentApply')}
              </button>
              <button type="button" className="import-btn import-btn--small" onClick={() => { setSelected(new Set()); setBulkMessage('') }}>
                {t('bulkClearSelection')}
              </button>
              {bulkMessage && (
                <span role="status" className="import-bulk__message">
                  {bulkMessage}
                </span>
              )}
            </div>
          )}

          <div className="import-table-wrap">
            <table className="import-table" aria-label={t('tableLabel')}>
              <thead>
                <tr>
                  <th style={{ width: 24 }}>
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      checked={allSelected}
                      onChange={() => { setBulkMessage(''); setSelected(allSelected ? new Set() : new Set(importable)) }}
                    />
                  </th>
                  <th>{t('colDate')}</th>
                  <th>{t('colDescription')}</th>
                  <th className="import-num">{t('colAmount')}</th>
                  <th>{t('colCounterAccount')}</th>
                  <th>{t('colCounterpartyBatch')}</th>
                  <th>{t('colProject')}</th>
                  <th>{t('colMember')}</th>
                  <th>{t('colComment')}</th>
                  <th>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleIndices.map((index) => {
                  const reviewRecord = records[index]
                  const state = session.rows[index]
                  const status = statusOf(index)
                  const desc = reviewRecord.record.description
                  const isDup = status === 'duplicate'
                  const account = accountList.find((a) => a.id === state.counterAccountId)
                  const showCounterparty = account === undefined || isCounterpartyEligibleCategory(account.category)
                  const defaultMemberId = defaultMemberIdOf(state.counterAccountId, accountList)
                  const taggable = isTaggableAccountId(state.counterAccountId, accountList)
                  const offerLearn = !isDup && shouldOfferLearn(reviewRecord, state) && state.counterpartyId !== null
                  const settingsDraft = state.counterpartyId === null ? null : (drafts.get(state.counterpartyId) ?? null)
                  const setCounterAccount = (id: number | null) =>
                    updateRow(index, (s) => withCounterAccount(s, id, accountList))
                  const statusText = status === 'new' ? t('statusNew') : status === 'duplicate' ? t('statusDuplicate') : t('statusCheck')

                  return (
                    <Fragment key={reviewRecord.externalId + index}>
                      <tr className={isDup ? 'import-row--dup' : undefined}>
                        <td>
                          {!isDup && (
                            <input
                              type="checkbox"
                              aria-label={t('selectRow', { desc })}
                              checked={selected.has(index)}
                              onChange={() => toggleSelected(index)}
                            />
                          )}
                        </td>
                        <td className="import-nowrap">{reviewRecord.record.entryDate.replaceAll('-', '/')}</td>
                        <td className="import-desc">{desc}</td>
                        <td className="import-num">{signedYen(reviewRecord.record.amount)}</td>
                        {isDup ? (
                          <td colSpan={5} className="import-dup-note">
                            {t('duplicateExcluded')}{' '}
                            <button
                              type="button"
                              className="import-link"
                              onClick={() => updateRow(index, (s) => ({ ...s, includeDuplicate: true }))}
                            >
                              {t('importAnyway')}
                            </button>
                          </td>
                        ) : (
                          <>
                            <td>
                              <TreeSelect
                                label={t('colCounterAccount')}
                                categories={categories.counterAccounts}
                                value={treeValue(state.counterAccountId)}
                                placeholder={t('chooseDefinition')}
                                onChange={(v) => setCounterAccount(toId(v))}
                                onCreate={() => setCreateTarget({ kind: 'counterAccount', apply: (id) => setCounterAccount(id) })}
                                createLabel={t('createCounterAccount')}
                              />
                            </td>
                            <td>
                              <div className="import-stack">
                                {showCounterparty && (
                                  <TreeSelect
                                    label={t('counterpartyLabel')}
                                    categories={categories.counterparties}
                                    value={treeValue(state.counterpartyId)}
                                    emptyLabel={t('noCounterpartyOption')}
                                    placeholder={t('noCounterpartyOption')}
                                    onChange={(v) =>
                                      updateRow(index, (s) => {
                                        const counterpartyId = toId(v)
                                        // 相手科目が未編集の間は、取引先の既定の科目に追従する(計画Issue #77)
                                        const nextAccountId = s.counterAccountTouched
                                          ? s.counterAccountId
                                          : suggestCounterpartyAccount(counterpartyId, counterpartyLookup)
                                        return {
                                          ...s,
                                          counterpartyId: resolveEligibleCounterpartyId(counterpartyId, nextAccountId, accountList),
                                          counterAccountId: nextAccountId,
                                        }
                                      })
                                    }
                                    onCreate={() =>
                                      setCreateTarget({
                                        kind: 'counterparty',
                                        apply: (id) => updateRow(index, (s) => ({ ...s, counterpartyId: id })),
                                      })
                                    }
                                    createLabel={t('createCounterparty')}
                                  />
                                )}
                                {showCounterparty && state.counterpartyId === null && state.candidateCounterpartyIds.length > 1 && (
                                  <span className="import-note">{t('noteCandidates', { count: state.candidateCounterpartyIds.length })}</span>
                                )}
                                {showCounterparty && offerLearn && (
                                  <CounterpartySettingsPopup
                                    isOpen={openSettings === index}
                                    onToggle={() => void toggleSettings(index)}
                                    onClose={() => setOpenSettings(null)}
                                    counterpartyName={data.counterparties.find((c) => c.id === state.counterpartyId)?.name ?? ''}
                                    draft={settingsDraft}
                                    descriptions={visibleIndices.map((i) => records[i].record.description)}
                                    rowDescription={desc}
                                    rowAccount={account !== undefined && isCounterpartyEligibleCategory(account.category) ? { id: account.id, name: account.name } : null}
                                    accountCategories={categories.defaultAccounts}
                                    message={settingsMessage}
                                    onChange={(next) => setDrafts((prev) => new Map(prev).set(next.counterpartyId, next))}
                                    onApply={() => settingsDraft && applySettingsToOtherRows(settingsDraft)}
                                  />
                                )}
                                {taggable && (
                                  <select
                                    className="import-control import-control--small"
                                    aria-label={t('rowBatch', { desc })}
                                    value={state.settlementBatchId ?? ''}
                                    onChange={(e) => updateRow(index, (s) => ({ ...s, settlementBatchId: toId(e.target.value) }))}
                                  >
                                    <option value="">{t('noBatch')}</option>
                                    {data.batches.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </td>
                            <td>
                              <TreeSelect
                                label={t('projectLabel')}
                                categories={categories.projects}
                                value={treeValue(state.projectId)}
                                emptyLabel={t('noProjectOption')}
                                placeholder={t('memberNone')}
                                onChange={(v) => updateRow(index, (s) => ({ ...s, projectId: toId(v) }))}
                                onCreate={() =>
                                  setCreateTarget({ kind: 'project', apply: (id) => updateRow(index, (s) => ({ ...s, projectId: id })) })
                                }
                                createLabel={t('createProject')}
                              />
                            </td>
                            <td>
                              <select
                                className="import-control import-control--small"
                                aria-label={t('rowMember', { desc })}
                                value={defaultMemberId ?? state.householdMemberId ?? ''}
                                disabled={defaultMemberId !== null}
                                onChange={(e) => updateRow(index, (s) => ({ ...s, householdMemberId: toId(e.target.value) }))}
                              >
                                <option value="">{t('memberNone')}</option>
                                {activeMembers.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                className="import-control import-control--small"
                                aria-label={t('rowComment', { desc })}
                                placeholder={t('commentPlaceholder')}
                                value={state.comment}
                                onChange={(e) => updateRow(index, (s) => ({ ...s, comment: e.target.value }))}
                              />
                            </td>
                          </>
                        )}
                        <td className={`import-status import-status--${status}`}>{statusText}</td>
                      </tr>
                      {!isDup && reviewRecord.approximateCandidates.length > 0 && (
                        <tr className="import-sub">
                          <td colSpan={4} />
                          <td colSpan={6}>
                            <div role="group" className="import-sub__body">
                              <span>{t('approximateDuplicateWarning')}</span>
                              {(
                                [
                                  ['unresolved', 'approximateDuplicateUnresolved'],
                                  ['confirmed_replacement', 'approximateDuplicateConfirmedReplacement'],
                                  ['different_transaction', 'approximateDuplicateDifferentTransaction'],
                                ] as [ApproximateDecision, string][]
                              ).map(([value, key]) => (
                                <label key={value} className="import-check">
                                  <input
                                    type="radio"
                                    name={`approximate-${index}`}
                                    checked={state.approximateDecision === value}
                                    onChange={() => updateRow(index, (s) => ({ ...s, approximateDecision: value }))}
                                  />
                                  {t(key)}
                                </label>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {session && session.review.unreadableRows.length > 0 && (
        <section
          aria-label={t('unreadableTitle', { count: session.review.unreadableRows.length })}
          className="import-panel"
        >
          <p className="import-panel__title">{t('unreadableTitle', { count: session.review.unreadableRows.length })}</p>
          {session.review.unreadableRows.length > session.review.records.length && (
            <p className="import-error">{t('unreadableMajorityWarning')}</p>
          )}
          <p className="import-note">{t('unreadableNote')}</p>
          <ul className="import-unreadable">
            {session.review.unreadableRows.map((row) => (
              <li key={row.rowNumber}>
                <span className="import-nowrap">{t('unreadableRow', { row: row.rowNumber })}</span>
                <span className="import-unreadable__cells">{row.cells.filter((c) => c !== '').join(' / ')}</span>
                <span className="import-error">
                  {row.error === 'invalidAmount' ? tMaster('mappingTab.errorInvalidAmount') : tMaster('mappingTab.errorInvalidDate')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {failures.length > 0 && (
        <ul role="alert" className="import-error">
          {failures.map((f) => (
            <li key={f.index}>{t('confirmFailureItem', { index: f.index + 1, message: f.message })}</li>
          ))}
        </ul>
      )}

      {(session || doneMessage) && (
        <div className="import-footer">
          {doneMessage && <span role="status" className="import-summary">{doneMessage}</span>}
          {session && importable.length > 0 && (
            <button
              type="button"
              className="import-btn import-btn--primary"
              disabled={busy || statementOwnerId === null || hasInvalidDraft}
              onClick={() => void handleConfirm()}
            >
              {t('confirmCount', { count: importable.length, account: session.targetAccount.name })}
            </button>
          )}
          {session && importable.length > 0 && statementOwnerId === null && (
            <span className="import-summary">{t('confirmBlockedNoOwner')}</span>
          )}
          {session && importable.length > 0 && hasInvalidDraft && <span className="import-error">{t('settingsInvalid')}</span>}
        </div>
      )}

      {createTarget?.kind === 'counterparty' && (
        <QuickCreateDialog
          title={t('createCounterpartyTitle')}
          nameLabel={t('createCounterpartyName')}
          onSubmit={(name) => createCounterparty(name, createTarget.apply)}
          onCancel={() => setCreateTarget(null)}
        />
      )}
      {createTarget?.kind === 'project' && (
        <QuickCreateDialog
          title={t('createProjectTitle')}
          nameLabel={t('createProjectName')}
          onSubmit={(name) => createProject(name, createTarget.apply)}
          onCancel={() => setCreateTarget(null)}
        />
      )}
      {showMappingDialog && csv && (
        <MappingCreateDialog bytes={csv.bytes} institutionNames={institutionNames} onSave={saveMappingAndContinue} onCancel={() => setShowMappingDialog(false)} />
      )}
      {(createTarget?.kind === 'counterAccount' || createTarget?.kind === 'targetAccount') && (
        <div className="import-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-label={t('createAccountTitle')} className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={accountRepository}
              balanceRecordRepository={accountBalanceRecordRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              initialCategory="asset"
              mappingLinking={{
                definitions: allDefinitions,
                repository: importMappingDefinitionRepository,
                // 取込先の追加では、いま取り込んでいる定義を最初からチェックする。相手科目の追加では付けない
                defaultDefinitionIds:
                  createTarget.kind === 'targetAccount' && match ? [match.definition.id] : undefined,
              }}
              onCreated={(created) => {
                setData((prev) => (prev ? { ...prev, accounts: [...prev.accounts, created] } : prev))
                createTarget.apply(created.id)
                setCreateTarget(null)
              }}
              onCancel={() => setCreateTarget(null)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
