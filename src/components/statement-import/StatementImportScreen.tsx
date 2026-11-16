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
import type { MultiFileSummary } from '../../domain/statement-import/buildMultiFileStatementImportReview'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import { buildConfirmedJournalEntryInput } from '../../domain/statement-import/buildConfirmedJournalEntryInput'
import {
  buildMultiFileStatementImportReview,
  type MultiFileStatementImportReviewResult,
} from '../../domain/statement-import/buildMultiFileStatementImportReview'
import { collectUnreferencedTransactions } from '../../domain/statement-import/collectUnreferencedTransactions'
import type { ApproximateDuplicateSearchOptions } from '../../domain/statement-import/duplicateDetection'
import { estimateCounterparty, normalizeDescriptionForMatching, type CounterpartyPatternLookup } from '../../domain/statement-import/estimateCounterparty'
import { resolveMultiFileMappingCandidates, type MultiFileMappingMatch } from '../../domain/statement-import/resolveMultiFileMappingCandidates'
import { suggestCounterpartyAccount, type CounterpartyLookup } from '../../domain/statement-import/suggestCounterpartyAccount'
import { runInHistoryGroup, type HistoryGroupApi } from '../../infrastructure/history/historyGroupRunner'
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
import { applyCounterpartySettingsToRows } from './applyCounterpartySettingsToRows'
import { CounterpartyCreateDialog, type CounterpartyCreateInput } from './CounterpartyCreateDialog'
import { countRowsContaining, validateKeyword, type KeywordError } from './counterpartyKeywordModel'
import type { KeywordListItem } from './KeywordList'
import { buildGroupSelectCategories } from '../common/tree-select/groupSelectCategories'
import { mappingFormToInput } from '../master/mappingForm'
import { QuickCreateDialog } from './QuickCreateDialog'
import { takePendingImportFiles } from './pendingImportFiles'
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
  /** 確定(複数の仕訳の作成)を操作履歴上1件にまとめる(計画Issue #202)。省略時はまとめない */
  history?: HistoryGroupApi
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
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll' | 'create'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll' | 'create'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll' | 'create'>>
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
  /** 取り込んだファイル名(複数のときは「、」でつなぐ) */
  fileName: string
  targetAccount: Account
  definition: ImportMappingDefinition
  review: MultiFileStatementImportReviewResult
  /** 取込済み(突合マスタ)の外部取引ID → 仕訳。「取り込み済みの仕訳を見る」に使う */
  existingRefs: Map<string, { journalEntryId: number; importedAt: string; entryDate: string; amount: number }>
  /** 取込先の既存の仕訳(内容の表示用) */
  existingEntries: Map<number, JournalEntry>
  rows: ImportRowState[]
  /** 取り込んだ直後の行の状態。編集したか(未保存の警告)の判定に使う */
  initialRows: ImportRowState[]
  /** 確定済みで一覧から外した行 */
  done: Set<number>
}

/** 「取引先の設定」のポップアップの状態。操作した時点でDBに保存する(摘要の提案だけは行の状態に持ち、確定時に登録する) */
interface SettingsView {
  index: number
  counterpartyId: number
  loaded: boolean
  /** 保存済みのキーワード。textは入力中の文字列、savedTextは保存済みの文字列 */
  registered: { key: string; id: number; text: string; savedText: string }[]
  /** 「+ キーワードを追加」で足した、入力を終えるまで保存しないキーワード */
  typing: { key: string; text: string }[]
  defaultAccountId: number | null
  /** 入力を終えたときの検証で見つかった問題(キーごと) */
  errors: Record<string, KeywordError>
  nextKey: number
}

/** 摘要の提案(確定時に登録するキーワード)の、一覧でのキー */
const SUGGESTION_KEY = 'suggestion'

type CreateTarget =
  | { kind: 'counterAccount' | 'project' | 'targetAccount'; apply: (id: number) => void }
  | { kind: 'counterparty'; rowIndex: number; apply: (id: number) => void }
  | null

/** 取引先の追加ダイアログの相手科目の初期値から開く科目の登録(計画Issue #218)。登録できた科目のidを返す先 */
type DefaultAccountCreate = ((accountId: number) => void) | null

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
    history,
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
  const [candidates, setCandidates] = useState<MultiFileMappingMatch[]>([])
  const [match, setMatch] = useState<MultiFileMappingMatch | null>(null)
  /** 選んだすべてのCSV(定義に合わないものも含む)。定義の新規作成のサンプルと、読み直しに使う */
  const [csvs, setCsvs] = useState<LoadedCsv[]>([])
  /** 取り込むファイルのチェック(ファイル名)。外したファイルは最初から選ばなかったものとして扱う(計画Issue #214) */
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())
  /** 定義で読めたファイルの期間・件数(チェックの有無によらず、期間の早い順) */
  const [fileSummaries, setFileSummaries] = useState<MultiFileSummary[]>([])
  /** 重複行のジャンプで強調している行(2秒ほど) */
  const [flashIndex, setFlashIndex] = useState<number | null>(null)
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
  const [defaultAccountCreate, setDefaultAccountCreate] = useState<DefaultAccountCreate>(null)
  /** 開いている「取引先の設定」(計画Issue #207)。登録済みのキーワードは開くたびにDBから読み込む */
  const [settings, setSettings] = useState<SettingsView | null>(null)
  /** 「ほかの行にも適用」を押した結果(開いているポップアップに出す) */
  const [settingsMessage, setSettingsMessage] = useState('')
  /** ポップアップでの保存に失敗したときの表示 */
  const [settingsSaveError, setSettingsSaveError] = useState('')
  /** 保存中のキーワード(入力を終えたときのフォーカス外れとEnterで二重に保存しないため) */
  const savingKeys = useRef(new Set<string>())
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

  // 仕訳画面の「明細から起票」で選んだCSVが渡されていれば、データの読み込み後に1回だけ読み込む(計画Issue #214)
  const pendingTaken = useRef(false)
  useEffect(() => {
    if (data === null || pendingTaken.current) return
    pendingTaken.current = true
    void loadFiles(takePendingImportFiles())
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const hasUnsavedEdits =
    session !== null &&
    session.rows.some((state, index) => !session.done.has(index) && isRowEdited(state, session.initialRows[index]))
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

  const keywordOf = (text: string) => normalizeDescriptionForMatching(text)

  /**
   * 開いている「取引先の設定」の一覧(登録済み → 摘要の提案 → 入力中)。摘要の提案は、推定と違う取引先を選んだ行で
   * 消していなければ「新規」として出し、その行を確定したときに登録する(行の取引先を後で変えても、不要なキーワードが残らない)。
   */
  function settingsItems(view: SettingsView): KeywordListItem[] {
    if (!session) return []
    const rowState = session.rows[view.index]
    const description = records[view.index].record.description
    const descriptions = visibleIndices.map((i) => records[i].record.description)
    const suggestion =
      shouldOfferLearn(records[view.index], rowState) && rowState.learnOn ? (rowState.learnPattern ?? description.trim()) : null
    const entries: { key: string; kind: 'registered' | 'new'; text: string; sourceDescription: string | null }[] = [
      ...view.registered.map((r) => ({ key: r.key, kind: 'registered' as const, text: r.text, sourceDescription: null })),
      ...(suggestion === null ? [] : [{ key: SUGGESTION_KEY, kind: 'new' as const, text: suggestion, sourceDescription: description }]),
      ...view.typing.map((k) => ({ key: k.key, kind: 'new' as const, text: k.text, sourceDescription: description })),
    ]
    return entries.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      text: entry.text,
      count: countRowsContaining(entry.text, descriptions),
      // 摘要の提案はその場で検証する(重複は後ろに足した方に出すので、登録済みとだけ比べる)。
      // それ以外は入力を終えたときの検証の結果を出す
      error:
        entry.key === SUGGESTION_KEY
          ? validateKeyword({
              text: entry.text,
              otherTexts: view.registered.map((r) => r.text),
              sourceDescription: entry.sourceDescription,
            })
          : (view.errors[entry.key] ?? null),
    }))
  }

  /** 「取引先の設定」を開く。登録済みのキーワードをDBから読み込む */
  async function toggleSettings(index: number) {
    if (!session) return
    const counterpartyId = session.rows[index].counterpartyId
    // 開いている取引先の設定が、いまの行の取引先のものなら閉じる。行の取引先を変えたあとの古い設定が残っていても、
    // 1回の操作で新しい取引先の設定が開く
    if (settings?.index === index && settings.counterpartyId === counterpartyId) {
      setSettings(null)
      return
    }
    if (counterpartyId === null) return
    const counterparty = data!.counterparties.find((c) => c.id === counterpartyId)
    setSettingsMessage('')
    setSettingsSaveError('')
    setSettings({
      index,
      counterpartyId,
      loaded: false,
      registered: [],
      typing: [],
      defaultAccountId: counterparty?.defaultAccountId ?? null,
      errors: {},
      nextKey: 0,
    })
    const registered = await Promise.resolve(counterpartyRepository.findPatternsByCounterparty(counterpartyId))
    setSettings((prev) =>
      prev && prev.index === index && prev.counterpartyId === counterpartyId
        ? {
            ...prev,
            loaded: true,
            registered: registered.map((p) => ({ key: `r${p.id}`, id: p.id, text: p.pattern, savedText: p.pattern })),
          }
        : prev,
    )
  }

  const withSettings = (update: (view: SettingsView) => SettingsView) =>
    setSettings((prev) => (prev === null ? prev : update(prev)))
  const clearError = (view: SettingsView, key: string): SettingsView => {
    const { [key]: _removed, ...errors } = view.errors
    return { ...view, errors }
  }

  function changeKeywordText(key: string, text: string) {
    if (!settings) return
    if (key === SUGGESTION_KEY) {
      updateRow(settings.index, (s) => ({ ...s, learnPattern: text }))
      return
    }
    withSettings((view) =>
      clearError(
        {
          ...view,
          registered: view.registered.map((r) => (r.key === key ? { ...r, text } : r)),
          typing: view.typing.map((k) => (k.key === key ? { ...k, text } : k)),
        },
        key,
      ),
    )
  }

  /**
   * 入力を終えたとき(フォーカスを外す・Enter)に保存する。1文字ごとには保存しない(途中の文字列が
   * キーワードとして登録され、ほかの行に誤って当たるのを避けるため)。問題があれば保存せずその場に出す。
   */
  async function commitKeyword(key: string) {
    if (!settings || key === SUGGESTION_KEY || savingKeys.current.has(key)) return
    const view = settings
    const description = records[view.index].record.description
    const registered = view.registered.find((r) => r.key === key)
    const typing = view.typing.find((k) => k.key === key)
    const text = registered?.text ?? typing?.text
    if (text === undefined) return
    if (registered && text === registered.savedText) return
    if (typing && text.trim() === '') {
      // 入力前の空欄は、何もせず取り除く
      withSettings((v) => ({ ...v, typing: v.typing.filter((k) => k.key !== key) }))
      return
    }
    const items = settingsItems(view)
    const error = validateKeyword({
      text,
      otherTexts: items.filter((item) => item.key !== key).map((item) => item.text),
      sourceDescription: typing ? description : null,
    })
    if (error !== null) {
      withSettings((v) => ({ ...v, errors: { ...v.errors, [key]: error } }))
      return
    }
    savingKeys.current.add(key)
    setSettingsSaveError('')
    try {
      if (registered) {
        await Promise.resolve(counterpartyRepository.updatePattern(registered.id, keywordOf(text)))
        withSettings((v) => ({ ...v, registered: v.registered.map((r) => (r.key === key ? { ...r, savedText: text } : r)) }))
      } else {
        const created = await Promise.resolve(counterpartyRepository.addPattern(view.counterpartyId, keywordOf(text)))
        // 保存できたら「登録済み」にする
        withSettings((v) => ({
          ...v,
          typing: v.typing.filter((k) => k.key !== key),
          registered: [...v.registered, { key: `r${created.id}`, id: created.id, text, savedText: text }],
        }))
      }
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    } finally {
      savingKeys.current.delete(key)
    }
  }

  async function deleteKeyword(key: string) {
    if (!settings) return
    if (key === SUGGESTION_KEY) {
      // 消した提案は、確定時にも登録しない
      updateRow(settings.index, (s) => ({ ...s, learnOn: false }))
      return
    }
    const registered = settings.registered.find((r) => r.key === key)
    if (!registered) {
      withSettings((view) => clearError({ ...view, typing: view.typing.filter((k) => k.key !== key) }, key))
      return
    }
    setSettingsSaveError('')
    try {
      await Promise.resolve(counterpartyRepository.deletePattern(registered.id))
      withSettings((view) => clearError({ ...view, registered: view.registered.filter((r) => r.key !== key) }, key))
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    }
  }

  function addKeyword() {
    withSettings((view) => ({ ...view, typing: [...view.typing, { key: `t${view.nextKey}`, text: '' }], nextKey: view.nextKey + 1 }))
  }

  /** 相手科目の初期値を選んだ時点で保存する */
  async function changeDefaultAccount(accountId: number | null) {
    if (!settings || !session) return
    setSettingsSaveError('')
    // 直前の「ほかの行にも適用」の結果が、今回の変更の結果として残らないようにする
    setSettingsMessage('')
    try {
      const updated = await Promise.resolve(
        counterpartyRepository.update(settings.counterpartyId, { defaultAccountId: accountId }),
      )
      setData((prev) =>
        prev ? { ...prev, counterparties: prev.counterparties.map((c) => (c.id === updated.id ? updated : c)) } : prev,
      )
      withSettings((view) => ({ ...view, defaultAccountId: accountId }))
      // 初期値は取引先ごとの設定なので、この取引先を持ち相手科目を手で選んでいない行(適用済みの行を含む)にも
      // 再適用なしで反映する(計画Issue #218)。取引先の設定(キーワード)は使わず、科目だけを追従させる。
      // 保存を待つ間に行が変わりうるので、状態はその時点の最新のものに対して計算する
      const followSettings = { counterpartyId: updated.id, keywords: [], defaultAccountId: accountId }
      const descriptions = records.map((r) => r.record.description)
      setSession((prev) => {
        if (prev === null) return prev
        const result = applyCounterpartySettingsToRows({
          states: prev.rows,
          initialStates: prev.initialRows,
          records,
          descriptions,
          done: prev.done,
          settings: followSettings,
          accounts: accountList,
        })
        return result.applied === 0 ? prev : { ...prev, rows: result.states, initialRows: result.initialStates }
      })
      // 反映した行数は、クリックした時点の行の状態から数えて示す(0行なら何も出さない)
      const followed = applyCounterpartySettingsToRows({
        states: session.rows,
        initialStates: session.initialRows,
        records,
        descriptions,
        done: session.done,
        settings: followSettings,
        accounts: accountList,
      }).applied
      if (followed > 0) setSettingsMessage(t('defaultAccountFollowed', { count: followed }))
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    }
  }

  /**
   * 「ほかの行にも適用」。一覧に出ているキーワード(登録済み・摘要の提案・入力中のもの)と相手科目の初期値を、
   * 取り込み中のほかの行へ画面上だけで反映する(この操作ではDBに書かない)
   */
  function applySettingsToOtherRows() {
    if (!session || !settings) return
    const result = applyCounterpartySettingsToRows({
      states: session.rows,
      initialStates: session.initialRows,
      records,
      descriptions: records.map((r) => r.record.description),
      done: session.done,
      settings: {
        counterpartyId: settings.counterpartyId,
        keywords: settingsItems(settings).map((item) => item.text),
        defaultAccountId: settings.defaultAccountId,
      },
      accounts: accountList,
    })
    setSession({ ...session, rows: result.states, initialRows: result.initialStates })
    setSettingsMessage(result.applied > 0 ? t('applyDone', { count: result.applied }) : t('applyNone'))
  }

  /** 取引先推定と相手科目のサジェストで、各行の初期値を作る(docs/domain/statement-import.md 1.5手順4・5) */
  async function computeInitialRows(
    review: MultiFileStatementImportReviewResult,
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

  /** 取込先とチェックしたファイルから、取り込む一覧を作る。チェックしたファイルが無ければ一覧は出さない */
  async function buildSession(account: Account, next: MultiFileMappingMatch, checked: ReadonlySet<string>) {
    const files = next.files.filter((f) => checked.has(f.fileName))
    if (files.length === 0) {
      setSession(null)
      return
    }
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
    // 期間が重なる複数ファイルの重複は、ファイル単位のハッシュで判定する(計画Issue #214、docs/domain/statement-import.md 1.6)
    const review = buildMultiFileStatementImportReview({
      files,
      definition: next.definition,
      existingExternalIds: new Set(existingRefs.map((ref) => ref.externalId)),
      existingTransactions,
      approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
    })
    const rows = await computeInitialRows(review, data!.counterparties, data!.accounts)
    setSession({
      fileName: files.map((f) => f.fileName).join('、'),
      targetAccount: account,
      definition: next.definition,
      review,
      existingRefs: new Map(
        existingRefs.map((ref) => [
          ref.externalId,
          { journalEntryId: ref.journalEntryId, importedAt: ref.importedAt, entryDate: ref.entryDate, amount: ref.amount },
        ]),
      ),
      existingEntries: new Map(all.map((entry) => [entry.id, entry])),
      rows,
      initialRows: rows,
      done: new Set(),
    })
    setSelected(new Set())
    setBulkMessage('')
    setSettings(null)
    setSettingsMessage('')
    setSettingsSaveError('')
  }

  /** 定義が決まったら、紐づく科目(取込先に選べるもの)の先頭を初期値にして取り込む。無ければ選ばせる */
  async function selectMatch(next: MultiFileMappingMatch) {
    setMatch(next)
    setSession(null)
    const everyFile = new Set(next.files.map((f) => f.fileName))
    setCheckedFiles(everyFile)
    // ファイルの期間・件数(チェックの有無によらず、期間の早い順)
    setFileSummaries(
      buildMultiFileStatementImportReview({
        files: next.files,
        definition: next.definition,
        existingExternalIds: new Set(),
        existingTransactions: [],
        approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
      }).files,
    )
    const linked = next.definition.accountIds
      .map((id) => data!.accounts.find((a) => a.id === id))
      .filter((a): a is Account => a !== undefined && isStatementImportEligibleAccount(a))
    const initial = linked[0] ?? null
    setTargetAccountId(initial?.id ?? null)
    if (initial) await buildSession(initial, next, everyFile)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? [])
    event.target.value = ''
    void loadFiles(picked)
  }

  async function loadFiles(picked: File[]) {
    if (picked.length === 0) return
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
      // 同じ名前のファイルを選んだときも、一覧のチェックで区別できるように名前を一意にする
      const used = new Map<string, number>()
      const loaded: LoadedCsv[] = []
      for (const file of picked) {
        const count = (used.get(file.name) ?? 0) + 1
        used.set(file.name, count)
        loaded.push({ fileName: count === 1 ? file.name : `${file.name} (${count})`, bytes: new Uint8Array(await file.arrayBuffer()) })
      }
      setCsvs(loaded)
      setCsv(loaded[0])
      // 取込先は定義から決まるので、まず全定義に実際のパースを試して絞り込む。複数ファイルは共通で読める定義を選ぶ
      const definitions = await Promise.resolve(importMappingDefinitionRepository.findAll())
      setInstitutionNames(collectFinancialInstitutionNames(definitions.map((d) => d.formatGroupId)))
      setAllDefinitions(definitions)
      const matches = resolveMultiFileMappingCandidates(loaded, definitions)
      if (matches.length === 0) {
        setNoMatch(true)
      } else if (matches.length === 1) {
        await selectMatch(matches[0])
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
      await selectMatch(next)
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
      await buildSession(account, match, checkedFiles)
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }

  /** ファイルのチェックを切り替える。外したファイルは選ばなかったものとして一覧を作り直す(入力済みの内容は失われるので警告を通す) */
  function toggleFile(fileName: string) {
    guarded(() => void applyFileToggle(fileName))
  }

  async function applyFileToggle(fileName: string) {
    {
      if (!match) return
      const next = new Set(checkedFiles)
      if (next.has(fileName)) next.delete(fileName)
      else next.add(fileName)
      setCheckedFiles(next)
      const account = data!.accounts.find((a) => a.id === targetAccountId)
      if (!account) return
      setBusy(true)
      try {
        await buildSession(account, match, next)
      } catch {
        setError(t('uploadError'))
      } finally {
        setBusy(false)
      }
    }
  }

  /** 画面内で作った定義を保存し、そのまま取り込みに進む */
  async function saveMappingAndContinue(form: MappingForm) {
    if (!csv) return
    const created = await Promise.resolve(importMappingDefinitionRepository.create(mappingFormToInput(form)))
    const matches = resolveMultiFileMappingCandidates(csvs, [created])
    if (matches.length === 0) throw new Error('created mapping does not parse the csv')
    setShowMappingDialog(false)
    setNoMatch(false)
    await selectMatch(matches[0])
  }

  const records = session?.review.records ?? []
  const visibleIndices = session ? records.map((_, i) => i).filter((i) => !session.done.has(i)) : []
  const statusOf = (i: number) => rowStatus(records[i], session!.rows[i])
  const importable = visibleIndices.filter((i) => statusOf(i) !== 'duplicate')
  const dupCount = visibleIndices.length - importable.length
  const crossFileDupCount = visibleIndices.filter(
    (i) => statusOf(i) === 'duplicate' && records[i].crossFileDuplicateOf !== null,
  ).length
  const showFileColumn = (session?.review.files.length ?? 0) >= 2
  /** 重複元の行 → 最初の重複した行(重複元の行から重複した行へ移る導線に使う) */
  const firstDuplicateOf = new Map<number, number>()
  records.forEach((r, i) => {
    if (r.crossFileDuplicateOf !== null && !firstDuplicateOf.has(r.crossFileDuplicateOf)) firstDuplicateOf.set(r.crossFileDuplicateOf, i)
  })
  const jumpToRow = (index: number) => {
    document.getElementById(`import-row-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashIndex(index)
    window.setTimeout(() => setFlashIndex((current) => (current === index ? null : current)), 2200)
  }
  const formatPeriod = (start: string, end: string) => {
    const from = start.replaceAll('-', '/')
    const to = end.replaceAll('-', '/')
    return from.slice(0, 4) === to.slice(0, 4) ? `${from}〜${to.slice(5)}` : `${from}〜${to}`
  }
  const overlapsOther = (file: MultiFileSummary) =>
    file.periodStart !== null &&
    file.periodEnd !== null &&
    fileSummaries.some(
      (other) =>
        other.fileName !== file.fileName &&
        other.periodStart !== null &&
        other.periodEnd !== null &&
        other.periodStart <= file.periodEnd! &&
        file.periodStart! <= other.periodEnd,
    )
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

  /**
   * 取引先をその場で追加する(計画Issue #207)。追加を押した時点で、取引先・キーワード・相手科目の初期値をまとめて保存する。
   * 追加した行は、ダイアログで決めたキーワードを使うので、摘要の提案(確定時の登録)は外す。
   */
  async function createCounterparty(input: CounterpartyCreateInput, apply: (id: number) => void) {
    const created = await Promise.resolve(
      counterpartyRepository.create({
        name: input.name,
        counterpartyGroupId: input.groupId,
        ...(input.defaultAccountId === null ? {} : { defaultAccountId: input.defaultAccountId }),
      }),
    )
    let keywordSaveFailed = false
    for (const keyword of input.keywords) {
      try {
        await Promise.resolve(counterpartyRepository.addPattern(created.id, keywordOf(keyword)))
      } catch {
        // 取引先の追加は成功しているので、残りの保存は続け、保存できなかったことは最後に知らせる
        keywordSaveFailed = true
      }
    }
    setData((prev) => (prev ? { ...prev, counterparties: [...prev.counterparties, created] } : prev))
    apply(created.id)
    if (input.applyToOtherRows) {
      // ダイアログのキーワードと相手科目の初期値を、ほかの行へ画面上だけで反映する(計画Issue #218)。
      // 追加した行は上のapplyで取引先が入る。保存を待つ間に行が変わりうるので、その時点の最新の状態に対して計算する
      setSession((prev) => {
        if (prev === null) return prev
        const result = applyCounterpartySettingsToRows({
          states: prev.rows,
          initialStates: prev.initialRows,
          records,
          descriptions: records.map((r) => r.record.description),
          done: prev.done,
          settings: { counterpartyId: created.id, keywords: input.keywords, defaultAccountId: input.defaultAccountId },
          accounts: accountList,
        })
        return result.applied === 0 ? prev : { ...prev, rows: result.states, initialRows: result.initialStates }
      })
    }
    setCreateTarget(null)
    if (keywordSaveFailed) setError(t('newKeywordSaveError'))
  }

  /** 追加ダイアログのグループ欄から、名前だけで最上位のグループをその場で作る(入れ子や並び順はグループ管理画面で) */
  async function createCounterpartyGroup(name: string): Promise<number> {
    const created = await Promise.resolve(counterpartyGroupRepository.create({ name }))
    setData((prev) => (prev ? { ...prev, counterpartyGroups: [...prev.counterpartyGroups, created] } : prev))
    return created.id
  }

  async function createProjectGroup(name: string): Promise<number> {
    const created = await Promise.resolve(projectGroupRepository.create({ name }))
    setData((prev) => (prev ? { ...prev, projectGroups: [...prev.projectGroups, created] } : prev))
    return created.id
  }

  async function createProject(name: string, groupId: number | null, apply: (id: number) => void) {
    const created = await Promise.resolve(projectRepository.create({ name, projectGroupId: groupId }))
    setData((prev) => (prev ? { ...prev, projects: [...prev.projects, created] } : prev))
    apply(created.id)
    setCreateTarget(null)
  }

  /** 確定(docs/domain/statement-import.md 1.5手順7)。1件が失敗しても残りの確定を続ける(継続処理方式) */
  async function handleConfirm(): Promise<boolean> {
    return runInHistoryGroup(history, 'statementImport.confirm', confirmImpl)
  }

  async function confirmImpl(): Promise<boolean> {
    if (!session || statementOwnerId === null) return false
    // 摘要から入るキーワード(「新規」)を直して不正にしたまま確定すると、気付かないまま登録が抜けるので、確定する前に止める
    const hasInvalidSuggestion = importable.some((index) => {
      const state = session.rows[index]
      if (!shouldOfferLearn(records[index], state) || state.counterpartyId === null || !state.learnOn || state.learnPattern === null) return false
      return validateKeyword({ text: state.learnPattern, otherTexts: [], sourceDescription: records[index].record.description }) !== null
    })
    if (hasInvalidSuggestion) {
      setError(t('suggestionInvalidError'))
      return false
    }
    setBusy(true)
    setError('')
    setDoneMessage('')
    const account = session.targetAccount
    const deleted = new Set<number>()
    const failed: ConfirmFailure[] = []
    const succeeded = new Set<number>()
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

        // 摘要の提案(「取引先の設定」で「新規」と出ているキーワード)は、この行を確定したときに登録する(計画Issue #207)。
        // パターンは正規化して保存する。取引先の推定(findByPattern)は正規化した摘要にSQLのLIKEで照合するため、
        // 空白や小文字を含んだまま保存すると、次回以降の推定に当たらない。
        // 摘要だけでは取引先が決まらなかった行(既定でオフ)や、消した提案は登録しない
        if (shouldOfferLearn(records[index], state) && state.counterpartyId !== null && state.learnOn) {
          const suggestion = (state.learnPattern ?? record.description).trim()
          if (validateKeyword({ text: suggestion, otherTexts: [], sourceDescription: record.description }) === null) {
            try {
              await Promise.resolve(counterpartyRepository.addPattern(state.counterpartyId, keywordOf(suggestion)))
              learned++
            } catch {
              // 同じキーワードが登録済みなど。確定自体は成功しているので無視する
            }
          }
        }
      } catch {
        failed.push({ index, message: t('confirmError') })
      }
    }

    if (succeeded.size > 0) {
      // 選んで取り込んだ定義を、取込先の科目に紐づける(次回から候補の先頭に出る)
      await Promise.resolve(importMappingDefinitionRepository.linkAccount(session.definition.id, account.id))
    }
    setSession({ ...session, done: new Set([...session.done, ...succeeded]) })
    setSelected(new Set())
    setFailures(failed)
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

  const noMatchTitle = csvs.length > 1 ? t('noMatchTitleMulti') : t('noMatchTitle', { fileName: csv?.fileName ?? '' })

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

      <input ref={fileInputRef} type="file" accept=".csv" multiple hidden aria-label={t('chooseCsv')} disabled={busy} onChange={handleFile} />
      {!csv && (
        <section aria-label={t('csvStartLabel')} className="import-start">
          {chooseCsvButton('import-btn import-btn--primary import-btn--large')}
          <p className="import-note">{t('csvStartNote')}</p>
        </section>
      )}

      {csv && noMatch && (
        <section role="alert" aria-label={noMatchTitle} className="import-panel">
          <p className="import-panel__title import-error">{noMatchTitle}</p>
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
            {match && fileSummaries.length >= 2 ? (
              <div className="import-field">
                <span className="import-field__label">{t('filesLabel')}</span>
                <ul className="import-files" aria-label={t('filesListLabel')}>
                  {fileSummaries.map((file) => (
                    <li key={file.fileName}>
                      <label className="import-files__check">
                        <input
                          type="checkbox"
                          aria-label={t('fileInclude', { name: file.fileName })}
                          checked={checkedFiles.has(file.fileName)}
                          disabled={busy}
                          onChange={() => toggleFile(file.fileName)}
                        />
                      </label>
                      <span className="import-files__name">{file.fileName}</span>
                      <span className="import-files__meta">
                        {file.periodStart !== null && file.periodEnd !== null ? formatPeriod(file.periodStart, file.periodEnd) : ''}
                      </span>
                      <span className="import-files__meta import-files__num">{t('fileCount', { count: file.recordCount })}</span>
                      <span className="import-files__meta">{overlapsOther(file) ? t('fileOverlap') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="import-field">
                <span className="import-field__label">CSV</span>
                <span className="import-panel__value">
                  {match ? (match.files[0]?.fileName ?? csv.fileName) : csvs.map((c) => c.fileName).join('、')}
                </span>
              </div>
            )}
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

      {csv && !noMatch && match && match.excluded.length > 0 && (
        <section aria-label={t('excludedTitle', { count: match.excluded.length })} className="import-panel">
          <p className="import-panel__title import-error">{t('excludedTitle', { count: match.excluded.length })}</p>
          <ul className="import-files">
            {match.excluded.map((file) => (
              <li key={file.fileName}>
                <span className="import-files__name">{file.fileName}</span>
                <span className="import-files__reason">
                  {file.reason.missingColumn !== null
                    ? t('excludedReasonColumn', { label: match.definition.label, column: file.reason.missingColumn.columnSpec })
                    : t('excludedReasonOther', { label: match.definition.label })}
                </span>
              </li>
            ))}
          </ul>
          <p className="import-note">{t('excludedNote')}</p>
        </section>
      )}

      {csv && match && targetAccountId === null && !noMatch && (
        <p className="import-empty">{t('pickAccountPrompt')}</p>
      )}
      {csv && match && targetAccountId !== null && !noMatch && session === null && checkedFiles.size === 0 && (
        <p className="import-empty">{t('pickFilePrompt')}</p>
      )}

      {session && visibleIndices.length > 0 && (
        <>
          <p className="import-summary">
            {showFileColumn
              ? t('loadedSummaryMulti', {
                  count: session.review.files.length,
                  newCount: importable.length,
                  dupCount: dupCount - crossFileDupCount,
                  crossFileDupCount,
                  checkCount,
                })
              : t('loadedSummary', { fileName: session.fileName, newCount: importable.length, dupCount, checkCount })}
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
                  {showFileColumn && <th>{t('colFile')}</th>}
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
                  const settingsView = settings !== null && settings.index === index && settings.counterpartyId === state.counterpartyId ? settings : null
                  const setCounterAccount = (id: number | null) =>
                    updateRow(index, (s) => withCounterAccount(s, id, accountList))
                  const statusText = status === 'new' ? t('statusNew') : status === 'duplicate' ? t('statusDuplicate') : t('statusCheck')

                  return (
                    <Fragment key={reviewRecord.externalId + index}>
                      <tr
                        id={`import-row-${index}`}
                        className={[isDup ? 'import-row--dup' : '', flashIndex === index ? 'import-row--flash' : ''].filter(Boolean).join(' ') || undefined}
                      >
                        {showFileColumn && (
                          <td className="import-file-col" title={reviewRecord.fileName}>
                            {reviewRecord.fileName}
                          </td>
                        )}
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
                            {reviewRecord.crossFileDuplicateOf !== null ? (
                              <>
                                {t('crossFileDuplicate', { fileName: records[reviewRecord.crossFileDuplicateOf].fileName })}
                                <button
                                  type="button"
                                  className="import-link import-jump"
                                  onClick={() => jumpToRow(reviewRecord.crossFileDuplicateOf!)}
                                >
                                  {t('jumpToOriginal')}
                                </button>
                              </>
                            ) : (
                              <>
                                {t('duplicateExcluded')}
                                {(() => {
                                  const ref = session.existingRefs.get(reviewRecord.externalId)
                                  const entry = ref ? session.existingEntries.get(ref.journalEntryId) : undefined
                                  return ref && entry ? (
                                    <details className="import-detail">
                                      <summary className="import-link">{t('viewExistingEntry')}</summary>
                                      <div className="import-detail__body">
                                        <span>
                                          {t('existingEntrySummary', {
                                            id: entry.id,
                                            date: ref.entryDate.replaceAll('-', '/'),
                                            memo: entry.memo ?? '',
                                            amount: signedYen(ref.amount),
                                          })}
                                        </span>
                                        <span className="import-note">
                                          {t('existingEntryImportedAt', { date: ref.importedAt.slice(0, 10).replaceAll('-', '/') })}
                                        </span>
                                      </div>
                                    </details>
                                  ) : null
                                })()}
                              </>
                            )}
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
                                        rowIndex: index,
                                        // 追加ダイアログで決めたキーワードを使うので、摘要の提案(確定時の登録)は外す
                                        apply: (id) => updateRow(index, (s) => ({ ...s, counterpartyId: id, learnOn: false })),
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
                                    isOpen={settingsView !== null}
                                    onToggle={() => void toggleSettings(index)}
                                    onClose={() => setSettings(null)}
                                    counterpartyName={data.counterparties.find((c) => c.id === state.counterpartyId)?.name ?? ''}
                                    items={settingsView === null || !settingsView.loaded ? null : settingsItems(settingsView)}
                                    defaultAccountId={settingsView?.defaultAccountId ?? null}
                                    accountCategories={categories.defaultAccounts}
                                    rowDescription={desc}
                                    message={settingsMessage}
                                    saveError={settingsSaveError}
                                    onTextChange={changeKeywordText}
                                    onCommit={(key) => void commitKeyword(key)}
                                    onDelete={(key) => void deleteKeyword(key)}
                                    onAdd={addKeyword}
                                    onDefaultAccountChange={(id) => void changeDefaultAccount(id)}
                                    onApply={applySettingsToOtherRows}
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
                        <td className={`import-status import-status--${status}`}>
                          {statusText}
                          {firstDuplicateOf.has(index) && (
                            <>
                              <br />
                              <button type="button" className="import-link import-jump" onClick={() => jumpToRow(firstDuplicateOf.get(index)!)}>
                                {t('jumpToDuplicate')}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {!isDup && reviewRecord.approximateCandidates.length > 0 && (
                        <tr className="import-sub">
                          <td colSpan={showFileColumn ? 5 : 4} />
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
              <li key={`${row.fileName}:${row.rowNumber}`}>
                <span className="import-nowrap">
                  {showFileColumn
                    ? t('unreadableRowInFile', { fileName: row.fileName, row: row.rowNumber })
                    : t('unreadableRow', { row: row.rowNumber })}
                </span>
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
              disabled={busy || statementOwnerId === null}
              onClick={() => void handleConfirm()}
            >
              {t('confirmCount', { count: importable.length, account: session.targetAccount.name })}
            </button>
          )}
          {session && importable.length > 0 && statementOwnerId === null && (
            <span className="import-summary">{t('confirmBlockedNoOwner')}</span>
          )}
        </div>
      )}

      {createTarget?.kind === 'counterparty' && session && (
        <CounterpartyCreateDialog
          rowDescription={records[createTarget.rowIndex].record.description}
          rowAccountId={(() => {
            // 取引先を持てない科目の行は、相手科目の初期値を未設定にする
            const rowAccount = accountList.find((a) => a.id === session.rows[createTarget.rowIndex].counterAccountId)
            return rowAccount !== undefined && isCounterpartyEligibleCategory(rowAccount.category) ? rowAccount.id : null
          })()}
          descriptions={visibleIndices.map((i) => records[i].record.description)}
          groupCategories={buildGroupSelectCategories(data.counterpartyGroups)}
          onCreateGroup={createCounterpartyGroup}
          accountCategories={categories.defaultAccounts}
          onCreateAccount={(onCreated) => setDefaultAccountCreate(() => onCreated)}
          onSubmit={(input) => createCounterparty(input, createTarget.apply)}
          onCancel={() => setCreateTarget(null)}
        />
      )}
      {createTarget?.kind === 'project' && (
        <QuickCreateDialog
          title={t('createProjectTitle')}
          nameLabel={t('createProjectName')}
          groupField={{ label: t('projectGroupLabel'), categories: buildGroupSelectCategories(data.projectGroups), onCreate: createProjectGroup }}
          onSubmit={(name, groupId) => createProject(name, groupId, createTarget.apply)}
          onCancel={() => setCreateTarget(null)}
        />
      )}
      {showMappingDialog && csv && (
        <MappingCreateDialog bytes={csv.bytes} institutionNames={institutionNames} onSave={saveMappingAndContinue} onCancel={() => setShowMappingDialog(false)} />
      )}
      {defaultAccountCreate !== null && (
        // 取引先の追加ダイアログの上に重ねて出す。登録した科目は初期値としてそのまま選ばれる
        <div className="import-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-label={t('createAccountTitle')} className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={accountRepository}
              balanceRecordRepository={accountBalanceRecordRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              initialCategory="expense"
              onCreated={(created) => {
                setData((prev) => (prev ? { ...prev, accounts: [...prev.accounts, created] } : prev))
                defaultAccountCreate(created.id)
                setDefaultAccountCreate(null)
              }}
              onCancel={() => setDefaultAccountCreate(null)}
            />
          </div>
        </div>
      )}
      {(createTarget?.kind === 'counterAccount' || createTarget?.kind === 'targetAccount') && (
        <div className="import-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-label={t('createAccountTitle')} className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={accountRepository}
              balanceRecordRepository={accountBalanceRecordRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              // 取込先は資産、相手科目は費用が既定(計画Issue #218)
              initialCategory={createTarget.kind === 'targetAccount' ? 'asset' : 'expense'}
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
