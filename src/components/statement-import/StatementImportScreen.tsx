import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
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
import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'
import { estimateKeywordRule, type KeywordRuleLookup } from '../../domain/statement-import/estimateKeywordRule'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import type { KeywordRuleRepository } from '../../domain/keyword-rule/KeywordRuleRepository'
import { resolveMultiFileMappingCandidates, type MultiFileMappingMatch } from '../../domain/statement-import/resolveMultiFileMappingCandidates'
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
  replacementTargetOf,
  resolveEligibleCounterpartyId,
  rowGroup,
  rowStatus,
  shouldOfferAccountLearn,
  shouldOfferLearn,
  withCounterAccount,
  type ApproximateDecision,
  type BulkChange,
  type ImportRowState,
} from './importRowModel'
import { countUncheckedByGroup, expandGroup, toggleCollapsedGroup, type CollapsedGroups } from './groupCollapse'
import { compareBySort, cycleSort, type ImportSort, type SortKey, type SortableRow } from './importRowSort'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { collectFinancialInstitutionNames } from '../../domain/statement-import/financialInstitution'
import { MappingCreateDialog } from './MappingCreateDialog'
import { CounterpartySettingsPopup } from './CounterpartySettingsPopup'
import { applyAccountKeywordsToRows } from './applyAccountKeywordsToRows'
import { applyCounterpartySettingsToRows } from './applyCounterpartySettingsToRows'
import { CounterpartyCreateDialog, type CounterpartyCreateInput } from './CounterpartyCreateDialog'
import { formatDescriptionForDisplay } from '../../domain/statement-import/formatDescriptionForDisplay'
import { countRowsContaining, matchesKeyword, validateKeyword, type KeywordError } from './counterpartyKeywordModel'
import type { KeywordListItem } from './KeywordList'
import { buildGroupSelectCategories } from '../common/tree-select/groupSelectCategories'
import { mappingFormToInput } from '../master/mappingForm'
import { QuickCreateDialog } from './QuickCreateDialog'
import { takePendingImportFiles } from './pendingImportFiles'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import './StatementImportScreen.css'

/**
 * 確定版候補(近似重複)探索の既定閾値。金融機関によって速報/確定のズレ方が異なるため
 * ドメイン層では規定されていない(docs/domain/statement-import.md 1.6)。警告が多すぎないよう、
 * 日付は3日以内、金額は取込側の金額の3%以内に絞る(速報と確定で3%を超えて動く取引は候補にしない)。
 */
const DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS: ApproximateDuplicateSearchOptions = {
  maxDateDiffDays: 3,
  maxAmountDiffRate: 0.03,
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
      | 'create'
    >
  >
  /** 摘要のキーワードルール(計画Issue #219)。取引先・相手科目の推定と、確定時の科目ルールの学習に使う */
  keywordRuleRepository: MaybeAsync<
    Pick<KeywordRuleRepository, 'findMatching' | 'findByAccount' | 'findByCounterparty' | 'create' | 'update' | 'delete'>
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
  /** 取引先のキーワードを開いているときの取引先(科目のキーワードを開いているときはnull) */
  counterpartyId: number | null
  /** 資産・負債の科目のキーワードを開いているときの科目(取引先のキーワードを開いているときはnull。計画Issue #219) */
  accountId: number | null
  loaded: boolean
  /** 保存済みのキーワード。textは入力中の文字列、savedTextは保存済みの文字列 */
  registered: { key: string; id: number; text: string; savedText: string; accountId: number | null }[]
  /** 「キーワードを追加」で足した、入力を終えるまで保存しないキーワード */
  typing: { key: string; text: string; accountId: number | null }[]
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
    keywordRuleRepository,
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
  /** 似た取引の「もっと見る」を開いている行 */
  const [openMore, setOpenMore] = useState<ReadonlySet<number>>(new Set())
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
  /**
   * 折りたたんでいるグループ(計画Issue #231 フェーズ1)。既定は全グループが開いている。折りたたんでも行は処理の対象のまま。
   * ファイルのチェックの切り替えによる作り直し・確定後の続きの選択では保ち、CSVの選び直し・取込先の変更では初期化する。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<CollapsedGroups>(new Set())
  /**
   * ヘッダーでの並び替え(計画Issue #231 フェーズ2)。グループの中だけを並べ、ヘッダーを押した時点の値で並びを決めて入力では動かさない。
   * 折りたたみと同じく、ファイルのチェックの切り替えによる作り直しでは保ち、CSVの選び直し・取込先の変更では解除する。
   */
  const [sort, setSort] = useState<ImportSort | null>(null)
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
  /**
   * ファイルのチェックを切り替えて一覧を作り直すとき、入力済みの内容を引き継ぐための記憶(外部取引ID → 行の状態)。
   * 外したファイルの行の内容も覚えておき、チェックを戻すと元に戻る。CSVを選び直す・取込先を変えると捨てる
   */
  const rowMemory = useRef(new Map<string, { state: ImportRowState; initial: ImportRowState }>())
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

  const updateRow = (index: number, update: (state: ImportRowState) => ImportRowState) =>
    setSession((prev) =>
      prev === null ? prev : { ...prev, rows: prev.rows.map((state, i) => (i === index ? update(state) : state)) },
    )

  const keywordOf = (text: string) => normalizeDescriptionForMatching(text)
  /** 取引先を持てる(費用・収益の)科目か。キーワードに紐づける科目はこの科目だけ */
  /** 取引先を持てない(資産・負債の)科目か。その科目のキーワードの設定を出す対象(計画Issue #219) */
  const isNonPlAccountId = (accountId: number | null): accountId is number => {
    const category = accountList.find((a) => a.id === accountId)?.category
    return category === 'asset' || category === 'liability'
  }
  const isPlAccountId = (accountId: number | null): accountId is number => {
    const category = accountList.find((a) => a.id === accountId)?.category
    return category !== undefined && isCounterpartyEligibleCategory(category)
  }
  /** 摘要の提案の科目。ダイアログで選んでいればその科目、選んでいなければ行の相手科目(取引先を持てる科目のときだけ) */
  const learnAccountIdOf = (state: ImportRowState): number | null =>
    state.learnAccountTouched ? state.learnAccountId : isPlAccountId(state.counterAccountId) ? state.counterAccountId : null
  /** キーワードの科目に選べる科目(取引先を持てる費用・収益の科目) */
  const keywordAccountOptions = accountList
    .filter((a) => isCounterpartyEligibleCategory(a.category))
    .map((a) => ({ id: a.id, name: a.name }))

  /**
   * 開いている「取引先の設定」の一覧(登録済み → 摘要の提案 → 入力中)。摘要の提案は、推定と違う取引先を選んだ行で
   * 消していなければ「新規」として出し、その行を確定したときに登録する(行の取引先を後で変えても、不要なキーワードが残らない)。
   */
  function settingsItems(view: SettingsView): KeywordListItem[] {
    if (!session) return []
    const rowState = session.rows[view.index]
    const description = records[view.index].record.description
    const descriptions = visibleIndices.map((i) => records[i].record.description)
    const accountKind = view.accountId !== null
    const offered = accountKind
      ? shouldOfferAccountLearn(records[view.index], rowState, accountList)
      : shouldOfferLearn(records[view.index], rowState)
    const suggestion = offered && rowState.learnOn ? (rowState.learnPattern ?? formatDescriptionForDisplay(description)) : null
    const suggestionAccountId = accountKind ? view.accountId : learnAccountIdOf(rowState)
    const entries: {
      key: string
      kind: 'registered' | 'new'
      text: string
      sourceDescription: string | null
      accountId: number | null
      accountLocked?: boolean
    }[] = [
      ...view.registered.map((r) => ({ key: r.key, kind: 'registered' as const, text: r.text, sourceDescription: null, accountId: r.accountId })),
      ...(suggestion === null
        ? []
        : [
            {
              key: SUGGESTION_KEY,
              kind: 'new' as const,
              text: suggestion,
              sourceDescription: description,
              // 摘要の提案の科目は、ダイアログで選ぶまでは、この行の相手科目(取引先を持てる科目のときだけ)。
              // 科目のキーワードの提案は、開いている科目に固定
              accountId: suggestionAccountId,
              accountLocked: accountKind,
            },
          ]),
      ...view.typing.map((k) => ({ key: k.key, kind: 'new' as const, text: k.text, sourceDescription: description, accountId: k.accountId })),
    ]
    return entries.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      text: entry.text,
      accountId: entry.accountId,
      accountLocked: entry.accountLocked,
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

  /**
   * 「取引先の設定」「キーワードの設定」を開く。登録済みのキーワードをDBから読み込む。取引先を持つ行は取引先のキーワード、
   * 取引先を持たず資産・負債の相手科目を持つ行は、その科目のキーワード(計画Issue #219)
   */
  async function toggleSettings(index: number) {
    if (!session) return
    const state = session.rows[index]
    const counterpartyId = state.counterpartyId
    const accountId = counterpartyId === null && isNonPlAccountId(state.counterAccountId) ? state.counterAccountId : null
    // 開いている設定が、いまの行の取引先・科目のものなら閉じる。行の取引先を変えたあとの古い設定が残っていても、
    // 1回の操作で新しい設定が開く
    if (settings?.index === index && settings.counterpartyId === counterpartyId && settings.accountId === accountId) {
      setSettings(null)
      return
    }
    if (counterpartyId === null && accountId === null) return
    setSettingsMessage('')
    setSettingsSaveError('')
    setSettings({
      index,
      counterpartyId,
      accountId,
      loaded: false,
      registered: [],
      typing: [],
      errors: {},
      nextKey: 0,
    })
    const registered = await Promise.resolve(
      counterpartyId !== null ? keywordRuleRepository.findByCounterparty(counterpartyId) : keywordRuleRepository.findByAccount(accountId!),
    )
    setSettings((prev) =>
      prev && prev.index === index && prev.counterpartyId === counterpartyId && prev.accountId === accountId
        ? {
            ...prev,
            loaded: true,
            registered: registered.map((p) => ({ key: `r${p.id}`, id: p.id, text: p.pattern, savedText: p.pattern, accountId: p.accountId })),
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
        await Promise.resolve(keywordRuleRepository.update(registered.id, { pattern: keywordOf(text) }))
        withSettings((v) => ({ ...v, registered: v.registered.map((r) => (r.key === key ? { ...r, savedText: text } : r)) }))
      } else {
        const created = await Promise.resolve(
          keywordRuleRepository.create({
            pattern: keywordOf(text),
            counterpartyId: view.counterpartyId,
            // 科目のキーワードは、開いている科目に結び付ける
            accountId: view.counterpartyId === null ? view.accountId : (typing?.accountId ?? null),
          }),
        )
        // 保存できたら「登録済み」にする
        withSettings((v) => ({
          ...v,
          typing: v.typing.filter((k) => k.key !== key),
          registered: [...v.registered, { key: `r${created.id}`, id: created.id, text, savedText: text, accountId: created.accountId }],
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
      await Promise.resolve(keywordRuleRepository.delete(registered.id))
      withSettings((view) => clearError({ ...view, registered: view.registered.filter((r) => r.key !== key) }, key))
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    }
  }

  function addKeyword() {
    withSettings((view) => ({ ...view, typing: [...view.typing, { key: `t${view.nextKey}`, text: '', accountId: null }], nextKey: view.nextKey + 1 }))
  }

  /**
   * キーワードの科目を選んだ時点で保存する(計画Issue #219)。入力中のキーワードは、入力を終えて保存するときに
   * 科目も一緒に保存する。摘要の提案の科目は、この行に覚えておき、確定時のキーワード登録に使う
   * (選んだあとは、行の相手科目を変えても追従しない)。
   */
  async function changeKeywordAccount(key: string, accountId: number | null) {
    if (!settings || !session || settings.counterpartyId === null) return
    // ダイアログを開いた行には、選んだ科目をその行の相手科目にも入れる(手で選んだ科目でも置き換える。
    // 行の相手科目を後から変えても、キーワード側の科目は変えない)
    const originIndex = settings.index
    const reflectToOriginRow = (text: string, syncInitial: boolean) => {
      if (accountId === null || !isPlAccountId(accountId) || !matchesKeyword(text, records[originIndex].record.description)) return
      setSession((prev) => {
        if (prev === null || prev.rows[originIndex].counterAccountId === accountId) return prev
        // 科目を手で選んだ扱いにはしない(キーワードの科目が変わればまた追従できるように)
        const next = { ...withCounterAccount(prev.rows[originIndex], accountId, accountList), counterAccountTouched: false }
        const rows = prev.rows.map((state, i) => (i === originIndex ? next : state))
        if (!syncInitial) return { ...prev, rows }
        const initial = { ...prev.initialRows[originIndex], counterAccountId: next.counterAccountId, counterpartyId: next.counterpartyId, initialCounterpartyId: next.counterpartyId, settlementBatchId: next.settlementBatchId, householdMemberId: next.householdMemberId }
        return { ...prev, rows, initialRows: prev.initialRows.map((state, i) => (i === originIndex ? initial : state)) }
      })
    }
    if (key === SUGGESTION_KEY) {
      const suggestionText = session.rows[originIndex].learnPattern ?? formatDescriptionForDisplay(records[originIndex].record.description)
      updateRow(originIndex, (s) => ({ ...s, learnAccountTouched: true, learnAccountId: accountId }))
      reflectToOriginRow(suggestionText, false)
      return
    }
    const counterpartyId = settings.counterpartyId
    const typing = settings.typing.find((k) => k.key === key)
    if (typing) {
      withSettings((view) => ({ ...view, typing: view.typing.map((k) => (k.key === key ? { ...k, accountId } : k)) }))
      reflectToOriginRow(typing.text, false)
      return
    }
    const registered = settings.registered.find((r) => r.key === key)
    if (!registered) return
    setSettingsSaveError('')
    // 直前の「ほかの行にも適用」の結果が、今回の変更の結果として残らないようにする
    setSettingsMessage('')
    try {
      await Promise.resolve(keywordRuleRepository.update(registered.id, { accountId }))
      withSettings((view) => ({ ...view, registered: view.registered.map((r) => (r.key === key ? { ...r, accountId } : r)) }))
      reflectToOriginRow(registered.text, true)
      // キーワードの科目は、そのキーワードに一致し、この取引先を持ち相手科目を手で選んでいない行(適用済みの行を含む)にも
      // 再適用なしで反映する(計画Issue #218・#219)。保存を待つ間に行が変わりうるので、状態はその時点の最新のものに対して計算する
      const followSettings = { counterpartyId, keywords: [{ text: registered.text, accountId }] }
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
   * 「ほかの行にも適用」。一覧に出ているキーワード(登録済み・摘要の提案・入力中のもの)と、キーワードごとの科目を、
   * 取り込み中のほかの行へ画面上だけで反映する(この操作ではDBに書かない)
   */
  function applySettingsToOtherRows() {
    if (!session || !settings) return
    if (settings.counterpartyId === null) {
      // 資産・負債の科目のキーワード: キーワードを含み、相手科目が未設定の行にその科目を入れる(計画Issue #219)
      if (settings.accountId === null) return
      const accountResult = applyAccountKeywordsToRows({
        states: session.rows,
        initialStates: session.initialRows,
        records,
        descriptions: records.map((r) => r.record.description),
        done: session.done,
        settings: { accountId: settings.accountId, keywords: settingsItems(settings).map((item) => item.text) },
        accounts: accountList,
      })
      setSession({ ...session, rows: accountResult.states, initialRows: accountResult.initialStates })
      setSettingsMessage(accountResult.applied > 0 ? t('applyDone', { count: accountResult.applied }) : t('applyNone'))
      return
    }
    const result = applyCounterpartySettingsToRows({
      states: session.rows,
      initialStates: session.initialRows,
      records,
      descriptions: records.map((r) => r.record.description),
      done: session.done,
      settings: {
        counterpartyId: settings.counterpartyId,
        keywords: settingsItems(settings).map((item) => ({ text: item.text, accountId: item.accountId ?? null })),
      },
      accounts: accountList,
    })
    setSession({ ...session, rows: result.states, initialRows: result.initialStates })
    setSettingsMessage(result.applied > 0 ? t('applyDone', { count: result.applied }) : t('applyNone'))
  }

  /**
   * キーワードルールの照合で、各行の初期値を作る(docs/domain/statement-import.md 1.5手順4・5、計画Issue #219)。
   * 取引先・相手科目は、一致したキーワードに紐づくものだけを入れ、一致しなければ空のままにする(候補は出さない)
   */
  async function computeInitialRows(
    review: MultiFileStatementImportReviewResult,
    accounts: readonly Account[],
  ): Promise<ImportRowState[]> {
    const normalizedList = [...new Set(review.records.map((r) => normalizeDescriptionForMatching(r.record.description)))]
    const rulesByText = new Map<string, KeywordRule[]>(
      await Promise.all(
        normalizedList.map(async (text) => [text, await Promise.resolve(keywordRuleRepository.findMatching(text))] as const),
      ),
    )
    const ruleLookup: KeywordRuleLookup = { findMatching: (text) => rulesByText.get(text) ?? [] }
    return review.records.map((r) => {
      const estimate = estimateKeywordRule(r.record.description, ruleLookup)
      const counterpartyId = estimate.counterpartyId
      // 相手科目は、ルールが科目を持てばその科目、なければ取引先の既定の科目(docs/domain/statement-import.md 1.5)
      const counterAccountId = estimate.accountId
      const candidates = [
        ...new Set(
          (rulesByText.get(normalizeDescriptionForMatching(r.record.description)) ?? []).flatMap((rule) =>
            rule.counterpartyId === null ? [] : [rule.counterpartyId],
          ),
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
  async function buildSession(account: Account, next: MultiFileMappingMatch, checked: ReadonlySet<string>, restoreRows = false) {
    const files = next.files.filter((f) => checked.has(f.fileName))
    // ファイルのチェックの切り替えによる作り直し(restoreRows)では、折りたたみの状態を保つ。それ以外は新しい取込なので初期化する
    if (!restoreRows) {
      setCollapsedGroups(new Set())
      setSort(null)
    }
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
    const computedRows = await computeInitialRows(review, data!.accounts)
    // ファイルのチェックを切り替えた作り直しでは、入力済みの内容を外部取引IDで引き継ぐ
    const remembered = (i: number) => (restoreRows ? rowMemory.current.get(review.records[i].externalId) : undefined)
    const rows = computedRows.map((row, i) => remembered(i)?.state ?? row)
    const initialRows = computedRows.map((row, i) => remembered(i)?.initial ?? row)
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
      initialRows,
      done: new Set(),
    })
    setSelected(new Set())
    setBulkMessage('')
    setSettings(null)
    setSettingsMessage('')
    setSettingsSaveError('')
  }

  /** 定義が決まったら、紐づく科目(取込先に選べるもの)が1つならそれを取込先にして取り込む。無い・複数なら選ばせる */
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
    // 紐づく科目が1つのときだけ自動で決める。複数あるときは、どれの明細かを利用者に選ばせる
    const initial = linked.length === 1 ? linked[0] : null
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
    rowMemory.current.clear()
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
    rowMemory.current.clear()
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

  /** ファイルのチェックを切り替える。外したファイルは選ばなかったものとして一覧を作り直す(入力済みの内容は引き継ぐので警告は出さない) */
  function toggleFile(fileName: string) {
    void applyFileToggle(fileName)
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
      // いまの一覧の行の内容を覚えてから作り直す
      if (session) {
        session.review.records.forEach((r, i) => rowMemory.current.set(r.externalId, { state: session.rows[i], initial: session.initialRows[i] }))
      }
      setBusy(true)
      try {
        await buildSession(account, match, next, true)
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
  // 一覧は「重複」→「似た取引あり」→「問題なし」の順に並べる。グループの中は、ヘッダーで並び替えていなければ取り込んだ順のまま、
  // 並び替えていればヘッダーを押した時点の値の順(計画Issue #231 フェーズ2)。保存時の並び(rowOrder)は、どちらでも元の順を使う
  const GROUP_ORDER = ['duplicate', 'similar', 'clean'] as const
  const visibleIndices = session
    ? records
        .map((_, i) => i)
        .filter((i) => !session.done.has(i))
        .sort(
          (a, b) =>
            GROUP_ORDER.indexOf(rowGroup(records[a])) - GROUP_ORDER.indexOf(rowGroup(records[b])) ||
            compareBySort(sort, records[a], records[b]) ||
            a - b,
        )
    : []
  const statusOf = (i: number) => rowStatus(records[i], session!.rows[i])
  const importable = visibleIndices.filter((i) => statusOf(i) !== 'duplicate' && statusOf(i) !== 'skipped')
  const skippedCount = visibleIndices.filter((i) => statusOf(i) === 'skipped').length
  const dupCount = visibleIndices.length - importable.length - skippedCount
  const similarCount = importable.filter((i) => rowGroup(records[i]) === 'similar').length
  const groupCounts = { duplicate: 0, similar: 0, clean: 0 }
  for (const i of visibleIndices) groupCounts[rowGroup(records[i])]++
  /** 見出しに出す「未確認」の行数。折りたたみ中も見えるので、見えない行の確認漏れに気づける */
  const uncheckedCounts = session
    ? countUncheckedByGroup(visibleIndices, records, session.rows)
    : { duplicate: 0, similar: 0, clean: 0 }
  /** 取込済み(突合マスタ)の仕訳のid。似た取引の出どころ(外部明細)の判定に使う */
  const externalEntryIds = new Set([...(session?.existingRefs.values() ?? [])].map((ref) => ref.journalEntryId))
  const sourceLabelOf = (journalEntryId: number) =>
    externalEntryIds.has(journalEntryId)
      ? t('sourceExternal')
      : session?.existingEntries.get(journalEntryId)?.sourceType === 'recurring_generated'
        ? t('sourceRecurring')
        : t('sourceManual')
  const crossFileDupCount = visibleIndices.filter(
    (i) => statusOf(i) === 'duplicate' && records[i].crossFileDuplicateOf !== null,
  ).length
  const showFileColumn = (session?.review.files.length ?? 0) >= 2
  /** 重複元の行 → 最初の重複した行(重複元の行から重複した行へ移る導線に使う) */
  const firstDuplicateOf = new Map<number, number>()
  records.forEach((r, i) => {
    if (r.crossFileDuplicateOf !== null && !firstDuplicateOf.has(r.crossFileDuplicateOf)) firstDuplicateOf.set(r.crossFileDuplicateOf, i)
  })
  /** ヘッダーを押した時点の表示対象の行から、並び替えの値を作る(押したあとに入力を変えても並びは動かない) */
  const toSortableRows = (): SortableRow[] =>
    visibleIndices.map((i) => {
      const state = session!.rows[i]
      return {
        externalId: records[i].externalId,
        fileName: records[i].fileName,
        entryDate: records[i].record.entryDate,
        description: formatDescriptionForDisplay(records[i].record.description),
        amount: records[i].record.amount,
        counterAccountName: accountList.find((a) => a.id === state.counterAccountId)?.name ?? '',
        counterpartyName: data.counterparties.find((c) => c.id === state.counterpartyId)?.name ?? '',
        status: statusOf(i),
      }
    })
  /** 並び替えできる列の見出し。ボタンで 昇順→降順→解除 を切り替え、aria-sort で今の状態を伝える */
  const sortHeader = (key: SortKey, label: string, className?: string) => {
    const direction = sort?.key === key ? sort.direction : null
    return (
      <th className={className} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
        <button
          type="button"
          className={`import-sort${direction !== null ? ' import-sort--on' : ''}`}
          onClick={() => setSort((prev) => cycleSort(prev, key, toSortableRows()))}
        >
          <span>{label}</span>
          <svg className="import-sort__mark" viewBox="0 0 12 12" aria-hidden="true">
            <path d={direction === 'asc' ? 'M2.5 8L6 4l3.5 4' : direction === 'desc' ? 'M2.5 4L6 8l3.5-4' : 'M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5'} />
          </svg>
        </button>
      </th>
    )
  }
  const jumpToRow = (index: number) => {
    // 移動先のグループが折りたたまれていたら、先に開いて描画してからスクロールする
    flushSync(() => setCollapsedGroups((prev) => expandGroup(prev, rowGroup(records[index]))))
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
   * 取引先をその場で追加する(計画Issue #207)。追加を押した時点で、取引先・キーワード(と、キーワードに紐づける科目)をまとめて保存する。
   * 追加した行は、ダイアログで決めたキーワードを使うので、摘要の提案(確定時の登録)は外す。
   */
  async function createCounterparty(input: CounterpartyCreateInput, apply: (id: number) => void) {
    const created = await Promise.resolve(
      counterpartyRepository.create({ name: input.name, counterpartyGroupId: input.groupId }),
    )
    let keywordSaveFailed = false
    for (const keyword of input.keywords) {
      try {
        await Promise.resolve(
          keywordRuleRepository.create({ pattern: keywordOf(keyword.text), counterpartyId: created.id, accountId: keyword.accountId }),
        )
      } catch {
        // 取引先の追加は成功しているので、残りの保存は続け、保存できなかったことは最後に知らせる
        keywordSaveFailed = true
      }
    }
    setData((prev) => (prev ? { ...prev, counterparties: [...prev.counterparties, created] } : prev))
    apply(created.id)
    if (input.applyToOtherRows) {
      // ダイアログのキーワードと科目を、ほかの行へ画面上だけで反映する(計画Issue #218)。
      // 追加した行は上のapplyで取引先が入る。保存を待つ間に行が変わりうるので、その時点の最新の状態に対して計算する
      setSession((prev) => {
        if (prev === null) return prev
        const result = applyCounterpartySettingsToRows({
          states: prev.rows,
          initialStates: prev.initialRows,
          records,
          descriptions: records.map((r) => r.record.description),
          done: prev.done,
          settings: { counterpartyId: created.id, keywords: input.keywords },
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
      const offered =
        (shouldOfferLearn(records[index], state) && state.counterpartyId !== null) || shouldOfferAccountLearn(records[index], state, accountList)
      if (!offered || !state.learnOn || state.learnPattern === null) return false
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
      const { record, externalId } = records[index]
      const state = session.rows[index]
      if (state.counterAccountId === null) {
        failed.push({ index, message: t('counterAccountRequiredError') })
        continue
      }
      // 「置き換える」を選んだのに、削除する登録済みの仕訳が決まっていない行は、何も削除せず取り込まない
      const replacementTargetId = replacementTargetOf(records[index], state)
      if (state.approximateDecision === 'confirmed_replacement' && replacementTargetId === null) {
        failed.push({ index, message: t('replacementTargetRequiredError') })
        continue
      }
      try {
        if (replacementTargetId !== null && !deleted.has(replacementTargetId)) {
          await Promise.resolve(journalEntryRepository.delete(replacementTargetId))
          deleted.add(replacementTargetId)
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
        // パターンは正規化して保存する。取引先の推定(KeywordRuleRepository.findMatching)は正規化した摘要にSQLのLIKEで照合するため、
        // 空白や小文字を含んだまま保存すると、次回以降の推定に当たらない。
        // 摘要だけでは取引先が決まらなかった行(既定でオフ)や、消した提案は登録しない
        if (shouldOfferLearn(records[index], state) && state.counterpartyId !== null && state.learnOn) {
          const suggestion = (state.learnPattern ?? formatDescriptionForDisplay(record.description)).trim()
          if (validateKeyword({ text: suggestion, otherTexts: [], sourceDescription: record.description }) === null) {
            try {
              // 取引先と、この行の相手科目(取引先を持てる科目のときだけ)を1つのルールにまとめて登録する
              await Promise.resolve(
                keywordRuleRepository.create({
                  pattern: keywordOf(suggestion),
                  counterpartyId: state.counterpartyId,
                  accountId: learnAccountIdOf(state),
                }),
              )
              learned++
            } catch {
              // 同じキーワードが登録済みなど。確定自体は成功しているので無視する
            }
          }
        }

        // 取引先を持てない(資産・負債)科目を相手科目に手で選んだ行は、摘要の提案(「キーワードの設定」で「新規」と出ているもの)を
        // その科目のキーワードルールとして、この行を確定したときに登録する(次回から摘要だけで相手科目が推定される。
        // 計画Issue #219、docs/decisions.md 2026-11-16 決定13)。消した提案は登録しない
        if (shouldOfferAccountLearn(records[index], state, accountList) && state.counterAccountId !== null && state.learnOn) {
          const suggestion = (state.learnPattern ?? formatDescriptionForDisplay(record.description)).trim()
          const keyword = keywordOf(suggestion)
          if (validateKeyword({ text: suggestion, otherTexts: [], sourceDescription: record.description }) === null) {
            try {
              const existing = await Promise.resolve(keywordRuleRepository.findByAccount(state.counterAccountId))
              if (!existing.some((rule) => rule.pattern === keyword)) {
                await Promise.resolve(keywordRuleRepository.create({ pattern: keyword, accountId: state.counterAccountId }))
                learned++
              }
            } catch {
              // 確定自体は成功しているので、ルールの登録に失敗しても無視する
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
    setSelected(new Set())
    if (failed.length === 0) {
      // 全件確定できたら、画面を取り込み前の状態に戻し、続けて明細を選ぶよう促す
      rowMemory.current.clear()
      setSettings(null)
      setSession(null)
      setCsv(null)
      setCsvs([])
      setMatch(null)
      setCandidates([])
      setNoMatch(false)
      setTargetAccountId(null)
      setCheckedFiles(new Set())
      setFileSummaries([])
    } else {
      setSession({ ...session, done: new Set([...session.done, ...succeeded]) })
    }
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
    visibleIndices.flatMap((i) => {
      const target = replacementTargetOf(records[i], session!.rows[i])
      return target === null ? [] : [target]
    }),
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
          {/* 紐づいているときの案内(「このマッピングは…に紐づいています」)は、取込先の欄から分かるので出さない(計画Issue #218) */}
          {match && match.definition.accountIds.length === 0 && <p className="import-note">{t('accountUnlinkedNote')}</p>}
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
            {similarCount > 0 && t('summarySimilar', { count: similarCount })}
            {skippedCount > 0 && t('summarySkipped', { count: skippedCount })}
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
              <button type="button" className="import-btn" onClick={() => applyBulk({ field: 'comment', value: bulkComment })}>
                {t('bulkCommentApply')}
              </button>
              <button
                type="button"
                className="import-btn import-bulk__clear"
                onClick={() => {
                  setSelected(new Set())
                  setBulkMessage('')
                }}
              >
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
                  {showFileColumn && sortHeader('file', t('colFile'))}
                  <th style={{ width: 24 }}>
                    <input
                      type="checkbox"
                      aria-label={t('selectAll')}
                      checked={allSelected}
                      onChange={() => { setBulkMessage(''); setSelected(allSelected ? new Set() : new Set(importable)) }}
                    />
                  </th>
                  {sortHeader('date', t('colDate'))}
                  {sortHeader('description', t('colDescription'))}
                  {sortHeader('amount', t('colAmount'), 'import-num')}
                  {sortHeader('counterAccount', t('colCounterAccount'))}
                  {sortHeader('counterparty', t('colCounterpartyBatch'))}
                  {/* プロジェクト・メンバー・コメントは入力欄の列なので、並び替えの対象にしない */}
                  <th>{t('colProject')}</th>
                  <th>{t('colMember')}</th>
                  <th>{t('colComment')}</th>
                  {sortHeader('status', t('colStatus'))}
                </tr>
              </thead>
              <tbody>
                {visibleIndices.map((index, position) => {
                  const reviewRecord = records[index]
                  const state = session.rows[index]
                  const status = statusOf(index)
                  const desc = formatDescriptionForDisplay(reviewRecord.record.description)
                  const isDup = status === 'duplicate'
                  const isSkipped = status === 'skipped'
                  const group = rowGroup(reviewRecord)
                  const startsGroup = position === 0 || rowGroup(records[visibleIndices[position - 1]]) !== group
                  const account = accountList.find((a) => a.id === state.counterAccountId)
                  const showCounterparty = account === undefined || isCounterpartyEligibleCategory(account.category)
                  const defaultMemberId = defaultMemberIdOf(state.counterAccountId, accountList)
                  const taggable = isTaggableAccountId(state.counterAccountId, accountList)
                  const offerLearn = !isDup && !isSkipped && shouldOfferLearn(reviewRecord, state) && state.counterpartyId !== null
                  const settingsView =
                    settings !== null && settings.index === index && settings.counterpartyId === state.counterpartyId && settings.accountId === null
                      ? settings
                      : null
                  // 取引先を持たず、資産・負債の相手科目を持つ行には、その科目のキーワードの設定を出す(計画Issue #219)
                  const accountSettingsId = !isDup && !isSkipped && state.counterpartyId === null && isNonPlAccountId(state.counterAccountId) ? state.counterAccountId : null
                  const accountSettingsView =
                    accountSettingsId !== null &&
                    settings !== null &&
                    settings.index === index &&
                    settings.counterpartyId === null &&
                    settings.accountId === accountSettingsId
                      ? settings
                      : null
                  const setCounterAccount = (id: number | null) =>
                    updateRow(index, (s) => withCounterAccount(s, id, accountList))
                  const statusText =
                    status === 'new' ? t('statusNew') : status === 'duplicate' ? t('statusDuplicate') : status === 'skipped' ? t('statusSkipped') : t('statusCheck')

                  const isCollapsed = collapsedGroups.has(group)
                  // 見出し全体を開閉のボタンにする(Tab・Enter・Spaceで操作でき、aria-expandedで状態を伝える)。
                  // 折りたたむとそのグループの行は描画しないが、件数・未確認の数は見出しに残す(計画Issue #231 フェーズ1)
                  const groupHeader = startsGroup ? (
                    <tr className="import-group">
                      <td colSpan={showFileColumn ? 11 : 10}>
                        <button
                          type="button"
                          className="import-group__head"
                          aria-expanded={!isCollapsed}
                          onClick={() => setCollapsedGroups((prev) => toggleCollapsedGroup(prev, group))}
                        >
                          <svg className="import-group__chevron" viewBox="0 0 16 16" aria-hidden="true">
                            <path d={isCollapsed ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'} />
                          </svg>
                          <span className="import-group__title">{t(`group_${group}`)}</span>
                          <span className="import-group__count">{t('groupCount', { count: groupCounts[group] })}</span>
                          {uncheckedCounts[group] > 0 && (
                            <span className="import-group__unchecked">{t('groupUnchecked', { count: uncheckedCounts[group] })}</span>
                          )}
                          <span className="import-group__note">{t(`group_${group}_note`)}</span>
                          {/* 重複は取り込み対象外なので、確定の対象という注記は出さない */}
                          {isCollapsed && group !== 'duplicate' && <span className="import-group__note">{t('groupCollapsedNote')}</span>}
                        </button>
                      </td>
                    </tr>
                  ) : null
                  if (isCollapsed) return <Fragment key={reviewRecord.externalId + index}>{groupHeader}</Fragment>

                  return (
                    <Fragment key={reviewRecord.externalId + index}>
                      {groupHeader}
                      <tr
                        id={`import-row-${index}`}
                        className={
                          [
                            isDup ? 'import-row--dup' : '',
                            group === 'similar' ? 'import-row--similar' : '',
                            // 入力済み(相手科目が決まっている)の行。重複・保存しない行は色分けの対象外(計画Issue #231 フェーズ2)
                            status === 'new' ? 'import-row--done' : '',
                            isSkipped ? 'import-row--skipped' : '',
                            flashIndex === index ? 'import-row--flash' : '',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined
                        }
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
                              disabled={isSkipped}
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
                                disabled={isSkipped}
                                onChange={(v) => setCounterAccount(toId(v))}
                                onCreate={() => setCreateTarget({ kind: 'counterAccount', apply: (id) => setCounterAccount(id) })}
                                createLabel={t('createCounterAccount')}
                              />
                              {accountSettingsId !== null && (
                                <CounterpartySettingsPopup
                                  kind="account"
                                  isOpen={accountSettingsView !== null}
                                  onToggle={() => void toggleSettings(index)}
                                  onClose={() => setSettings(null)}
                                  counterpartyName={account?.name ?? ''}
                                  items={accountSettingsView === null || !accountSettingsView.loaded ? null : settingsItems(accountSettingsView)}
                                  rowDescription={desc}
                                  message={settingsMessage}
                                  saveError={settingsSaveError}
                                  onTextChange={changeKeywordText}
                                  onCommit={(key) => void commitKeyword(key)}
                                  onDelete={(key) => void deleteKeyword(key)}
                                  onAdd={addKeyword}
                                  onAccountChange={() => undefined}
                                  onApply={applySettingsToOtherRows}
                                />
                              )}
                            </td>
                            <td>
                              <div className="import-stack">
                                {showCounterparty && (
                                  <TreeSelect
                                    label={t('counterpartyLabel')}
                                    disabled={isSkipped}
                                    categories={categories.counterparties}
                                    value={treeValue(state.counterpartyId)}
                                    emptyLabel={t('noCounterpartyOption')}
                                    placeholder={t('noCounterpartyOption')}
                                    onChange={(v) =>
                                      // 取引先を手で選んでも、相手科目は自動で入れない(科目はキーワードに紐づくものだけ。計画Issue #219)
                                      updateRow(index, (s) => ({
                                        ...s,
                                        counterpartyId: resolveEligibleCounterpartyId(toId(v), s.counterAccountId, accountList),
                                      }))
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
                                    accountOptions={keywordAccountOptions}
                                    accountCategories={categories.defaultAccounts}
                                    rowDescription={desc}
                                    message={settingsMessage}
                                    saveError={settingsSaveError}
                                    onTextChange={changeKeywordText}
                                    onCommit={(key) => void commitKeyword(key)}
                                    onDelete={(key) => void deleteKeyword(key)}
                                    onAdd={addKeyword}
                                    onAccountChange={(key, id) => void changeKeywordAccount(key, id)}
                                    onApply={applySettingsToOtherRows}
                                  />
                                )}
                                {taggable && (
                                  <select
                                    className="import-control import-control--small"
                                    aria-label={t('rowBatch', { desc })}
                                    value={state.settlementBatchId ?? ''}
                                    disabled={isSkipped}
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
                                disabled={isSkipped}
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
                                disabled={isSkipped || defaultMemberId !== null}
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
                                disabled={isSkipped}
                                placeholder={t('commentPlaceholder')}
                                value={state.comment}
                                onChange={(e) => updateRow(index, (s) => ({ ...s, comment: e.target.value }))}
                              />
                            </td>
                          </>
                        )}
                        <td className={`import-status import-status--${status}`}>
                          {/* 色だけに頼らないよう、入力済み(新規)には✓、未入力(要確認)には破線の丸を添える。読み上げは文字のまま */}
                          {status === 'new' && (
                            <svg className="import-status__mark import-status__mark--done" viewBox="0 0 14 14" aria-hidden="true">
                              <path d="M2.5 7.5l3 3 6-6.5" />
                            </svg>
                          )}
                          {status === 'check' && (
                            <svg className="import-status__mark import-status__mark--todo" viewBox="0 0 14 14" aria-hidden="true">
                              <circle cx="7" cy="7" r="4.5" />
                            </svg>
                          )}
                          {statusText}
                          {reviewRecord.isExactDuplicate && state.includeDuplicate && (
                            <>
                              <br />
                              <button
                                type="button"
                                className="import-link"
                                onClick={() => updateRow(index, (s) => ({ ...s, includeDuplicate: false }))}
                              >
                                {t('excludeAgain')}
                              </button>
                            </>
                          )}
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
                        <tr className={`import-sub import-sub--similar${status === 'new' ? ' import-sub--done' : ''}`}>
                          <td />
                          <td colSpan={showFileColumn ? 10 : 9}>
                            <div role="group" aria-label={t('similarGroupLabel', { desc })} className="import-similar">
                              <div className="import-similar__line">
                                <span className="import-similar__title">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M12 3l10 18H2z" />
                                    <path d="M12 10v5M12 18.5v.01" />
                                  </svg>
                                  {t('similarTitle')}
                                </span>
                                {reviewRecord.approximateCandidates.length > 1 && (
                                  <button
                                    type="button"
                                    className="import-link"
                                    onClick={() =>
                                      setOpenMore((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(index)) next.delete(index)
                                        else next.add(index)
                                        return next
                                      })
                                    }
                                  >
                                    {openMore.has(index) ? t('similarMoreClose') : t('similarMore', { count: reviewRecord.approximateCandidates.length - 1 })}
                                  </button>
                                )}
                              </div>
                              <div role="list" className="import-similar__list">
                                {(openMore.has(index) ? reviewRecord.approximateCandidates : reviewRecord.approximateCandidates.slice(0, 1)).map((candidate) => {
                                  const entry = session.existingEntries.get(candidate.journalEntryId)
                                  return (
                                    <div role="listitem" key={candidate.journalEntryId} className="import-similar__item">
                                      <span className="import-tag import-tag--registered">{sourceLabelOf(candidate.journalEntryId)}</span>
                                      <span className="import-nowrap">{candidate.entryDate.replaceAll('-', '/')}</span>
                                      <span className="import-similar__memo">{entry?.memo ?? ''}</span>
                                      <span className="import-similar__amount">{signedYen(candidate.amount)}</span>
                                      <details className="import-detail import-similar__open">
                                        <summary className="import-link">{t('openEntry')}</summary>
                                        <div className="import-detail__body">
                                          <span>
                                            {t('existingEntrySummary', {
                                              id: candidate.journalEntryId,
                                              date: candidate.entryDate.replaceAll('-', '/'),
                                              memo: entry?.memo ?? '',
                                              amount: signedYen(candidate.amount),
                                            })}
                                          </span>
                                        </div>
                                      </details>
                                    </div>
                                  )
                                })}
                              </div>
                              <div role="radiogroup" aria-label={t('similarChoiceLabel', { desc })} className="import-similar__choices">
                                {(
                                  [
                                    ['different_transaction', 'similarAdd'],
                                    ['confirmed_replacement', 'similarReplace'],
                                    ['skip', 'similarSkip'],
                                  ] as [ApproximateDecision, string][]
                                ).map(([value, key]) => (
                                  <Fragment key={value}>
                                    <label className={`import-check${state.approximateDecision === value ? ' import-check--on' : ''}`}>
                                      <input
                                        type="radio"
                                        name={`approximate-${index}`}
                                        checked={state.approximateDecision === value}
                                        onChange={() => updateRow(index, (s) => ({ ...s, approximateDecision: value }))}
                                      />
                                      {t(key)}
                                    </label>
                                    {value === 'confirmed_replacement' &&
                                      state.approximateDecision === 'confirmed_replacement' &&
                                      reviewRecord.approximateCandidates.length > 1 && (
                                        <select
                                          className="import-control import-control--tiny"
                                          aria-label={t('replacementTargetLabel')}
                                          value={state.replacementTargetId ?? ''}
                                          onChange={(e) => updateRow(index, (s) => ({ ...s, replacementTargetId: toId(e.target.value) }))}
                                        >
                                          <option value="">{t('replacementTargetPlaceholder')}</option>
                                          {reviewRecord.approximateCandidates.map((candidate) => (
                                            <option key={candidate.journalEntryId} value={candidate.journalEntryId}>
                                              {`[${sourceLabelOf(candidate.journalEntryId)}]  ${candidate.entryDate.replaceAll('-', '/')}  ${
                                                session.existingEntries.get(candidate.journalEntryId)?.memo ?? ''
                                              }  ${signedYen(candidate.amount)}`}
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td />
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
          rowDescription={formatDescriptionForDisplay(records[createTarget.rowIndex].record.description)}
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
