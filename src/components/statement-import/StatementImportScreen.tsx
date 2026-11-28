import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountGroup, CreateAccountGroupInput } from '../../domain/account-group/AccountGroup'
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
import { rankAccountCandidates } from '../../domain/statement-import/rankAccountCandidates'
import { rankCounterpartyCandidates } from '../../domain/statement-import/rankCounterpartyCandidates'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import type { KeywordRuleRepository } from '../../domain/keyword-rule/KeywordRuleRepository'
import { resolveMultiFileMappingCandidates, type MultiFileMappingMatch } from '../../domain/statement-import/resolveMultiFileMappingCandidates'
import { runInHistoryGroup, type HistoryGroupApi } from '../../infrastructure/history/historyGroupRunner'
import type { OperationMeta } from '../../infrastructure/history/operationDetail'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { useEscapeToClear } from '../common/range-selection/useEscapeToClear'
import { createRangeSelection, useRangeAnchor } from '../common/range-selection/useRangeSelection'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import type { AccountBalanceRecordRepository } from '../../domain/reconciliation/AccountBalanceRecordRepository'
import { AccountCreateForm } from '../master/AccountCreateForm'
import { buildTreeSelectCategories } from '../master/buildTreeSelectCategories'
import { AccountSelect } from '../master/AccountSelect'
import { BulkBarField, BulkBarFrame } from '../common/bulk-bar/BulkBarFrame'
import { BatchSelect } from '../master/BatchSelect'
import { MappingDefinitionSelect } from './MappingDefinitionSelect'
import { MemberSelect } from '../master/MemberSelect'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from '../master/masterTreeNodes'
import type { MappingForm } from '../master/mappingForm'
import type { MaybeAsync } from '../master/maybeAsync'
import { isStatementImportEligibleAccount, isStatementImportCounterAccountEligible } from './statementImportEligibility'
import {
  createInitialRowState,
  defaultMemberIdOf,
  hasUnsavedRows,
  isTaggableAccountId,
  replacementTargetOf,
  resolveEligibleCounterpartyId,
  rowGroup,
  rowStatus,
  withCounterAccount,
  type ApproximateDecision,
  type ImportRowState,
} from './importRowModel'
import {
  BULK_CLEAR_VALUE,
  EMPTY_IMPORT_BULK_PICK,
  applyImportBulkPick,
  importBulkRules,
  isImportBulkPickEmpty,
  pickChangeToValue,
  sanitizeImportBulkPick,
  valueToPickChange,
  type ImportBulkPick,
} from './importBulkPickModel'
import {
  IMPORT_PAGE_SIZE,
  buildTabIndices,
  importTabPanelId,
  pageRange,
  summarizeTabs,
  type ImportTabKey,
  type RowTab,
} from './importTabs'
import { ImportTabBar, type ImportTabItem } from './ImportTabBar'
import { ImportPager } from './ImportPager'
import { FilterToggleButton } from '../common/filter-toggle/FilterToggleButton'
import { FloatingTableHeader } from '../common/sticky/FloatingTableHeader'
import { useElementHeight } from '../common/sticky/useElementHeight'
import { KeepRowsInPlace } from '../common/sticky/useKeepRowsInPlace'
import {
  activeConditionCount,
  batchFilterCategories,
  EMPTY_FILTER_INPUT,
  isRowFilterActive,
  matchesRowFilter,
  memberFilterCategories,
  pruneSelection,
  resolveFilterInput,
  type ImportFilterInput,
  type ImportRowFilter,
} from './importRowFilter'
import { ImportRowFilterPanel } from './ImportRowFilterPanel'
import { compareBySort, cycleSort, type ImportSort, type SortKey, type SortableRow } from './importRowSort'
import { SortableHeaderCell } from '../common/table-sort/SortableHeaderCell'
import { ConfirmDialog } from '../common/confirm-dialog/ConfirmDialog'
import { countFilledRowsOverwritten } from './overwriteSummary'
import type {
  StatementImportDraft,
  StatementImportDraftRowInput,
  StatementImportDraftSummary,
} from '../../domain/statement-import/StatementImportDraft'
import type { StatementImportDraftRepository } from '../../domain/statement-import/StatementImportDraftRepository'
import { applyDraftRowInput, collectDraftRowInputs } from './draftRowInputs'
import { formatDraftSavedAt } from './draftDisplay'
import { isCounterpartyEligibleCategory } from '../journal-entry/journalEntryFormLine'
import { collectFinancialInstitutionNames } from '../../domain/statement-import/financialInstitution'
import { MappingCreateDialog } from './MappingCreateDialog'
import { CounterpartySettingsPopup } from './CounterpartySettingsPopup'
import { applyAccountKeywordsToRows } from './applyAccountKeywordsToRows'
import { applyCounterpartySettingsToRows } from './applyCounterpartySettingsToRows'
import { CounterpartyCreateDialog, type CounterpartyCreateInput } from './CounterpartyCreateDialog'
import { buildWebSearchUrl } from '../../domain/statement-import/buildWebSearchUrl'
import { formatDescriptionForDisplay } from '../../domain/statement-import/formatDescriptionForDisplay'
import { SearchIcon } from '../icons/ActionIcons'
import { countRowsContaining, matchesKeyword, mostFrequentAccountId, validateKeyword, type KeywordError } from './counterpartyKeywordModel'
import type { KeywordListItem } from './KeywordList'
import { mappingFormToInput } from '../master/mappingForm'
import { QuickCreateDialog } from './QuickCreateDialog'
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
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll' | 'create'>>
  importMappingDefinitionRepository: MaybeAsync<
    Pick<ImportMappingDefinitionRepository, 'findAll' | 'create' | 'linkAccount'>
  >
  externalTransactionRefRepository: { findByAccount(accountId: number): ExternalTransactionRef[] | Promise<ExternalTransactionRef[]> }
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll' | 'create' | 'delete'>>
  /** 科目の登録フォームで最初の残高を記録する先(計画Issue #205)。省略時は最初の残高の欄を出さない */
  accountBalanceRecordRepository?: MaybeAsync<Pick<AccountBalanceRecordRepository, 'create'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll' | 'create'>> & {
    /** 摘要に複数のキーワードが一致した行の取引先の候補を並べるときの「過去の使用件数」(計画Issue #236)。渡さなければ使用件数は0として並べる */
    countJournalLinesByCounterparty?: () => ReturnType<CounterpartyRepository['countJournalLinesByCounterparty']> | Promise<ReturnType<CounterpartyRepository['countJournalLinesByCounterparty']>>
  }
  /** 摘要のキーワードルール(計画Issue #219)。取引先・相手科目の推定と、確定時の科目ルールの学習に使う */
  keywordRuleRepository: MaybeAsync<
    Pick<KeywordRuleRepository, 'findAll' | 'findMatching' | 'findByAccount' | 'findByCounterparty' | 'create' | 'update' | 'delete'>
  >
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll' | 'create'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll' | 'create'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll' | 'create'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<Pick<SettlementBatchRepository, 'findAll' | 'create'>>
  /** 明細取込の一時保存(計画Issue #231 フェーズ3)。取込先の科目ごとに1つ。CSVの生データと、初期値から変えた行の入力を保存する */
  statementImportDraftRepository: MaybeAsync<
    Pick<StatementImportDraftRepository, 'findSummaries' | 'findById' | 'findByAccountId' | 'save' | 'delete'>
  >
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

/** キーワードのポップアップの状態(計画Issue #259)。操作した時点・入力を終えたとき・閉じるときにDBに保存する */
interface SettingsView {
  index: number
  /** 取引先のキーワードを開いているときの取引先(科目のキーワードを開いているときはnull) */
  counterpartyId: number | null
  /** 科目のキーワード(取引先なしでその科目を持つキーワード)を開いているときの科目(取引先のキーワードを開いているときはnull。計画Issue #219・#259) */
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

type CreateTarget =
  | { kind: 'counterAccount' | 'project' | 'targetAccount'; apply: (id: number) => void }
  | { kind: 'counterparty'; rowIndex: number; apply: (id: number) => void }
  | null

/** 一括編集の選択欄の先頭に固定して出す「なし(外す)」(計画Issue #300)。参照を安定させるためモジュールの定数にする */
const bulkClearOptions = [{ value: BULK_CLEAR_VALUE, label: 'なし(外す)' }]

/** 取引先の追加ダイアログの相手科目の初期値から開く科目の登録(計画Issue #218)。登録できた科目のidを返す先 */
type DefaultAccountCreate = ((accountId: number) => void) | null

/** 取込画面で選んだCSV。定義の作成ダイアログや、文字コードの違う定義での読み直しに元のバイト列を持つ */
interface LoadedCsv {
  fileName: string
  bytes: Uint8Array
}

/**
 * 確定でエラーとして残すものは2つだけ(計画Issue #263)。confirm=登録時の例外、replacement=「置き換える」を選んだのに
 * 削除する登録済みの仕訳が未選択。どちらも該当行の直下に出す。相手科目が未入力の行はエラーにせず、確定の対象から外す
 */
type RowErrorKind = 'confirm' | 'replacement'

/** 行内エラーの先頭に添える丸の「!」。色だけに頼らず、エラーだと分かるようにする */
function RowErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.01" />
    </svg>
  )
}

/** 直前の確定の結果。確定後の案内(黄色の1行)に出す件数 */
interface ConfirmResult {
  succeeded: number
  /** 相手科目が未入力で、確定の対象から外した行の数 */
  unfilled: number
  /** 確定できなかった行(エラー)の数 */
  failed: number
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
    statementImportDraftRepository,
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
  /** 複数のマッピング定義に一致したときの選択欄の候補。参照を安定させるため、候補が変わったときだけ作り直す */
  const candidateDefinitions = useMemo(() => candidates.map((m) => m.definition), [candidates])
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
  /** 開いているタブと、行のあるタブごとのページ(計画Issue #263)。新しい取込では最初に戻す */
  const [activeTab, setActiveTab] = useState<ImportTabKey>('new')
  const [pages, setPages] = useState<Record<RowTab, number>>({ new: 1, duplicate: 1 })
  /**
   * ヘッダーでの並び替え(計画Issue #231 フェーズ2)。グループの中だけを並べ、ヘッダーを押した時点の値で並びを決めて入力では動かさない。
   * 折りたたみと同じく、ファイルのチェックの切り替えによる作り直しでは保ち、CSVの選び直し・取込先の変更では解除する。
   */
  const [sort, setSort] = useState<ImportSort | null>(null)
  /** 列ごとの行の絞り込みの条件(計画Issue #258)。表示だけの条件で、一時保存には含めない。新しい取込では解除する */
  const [rowFilterInput, setRowFilterInput] = useState<ImportFilterInput>(EMPTY_FILTER_INPUT)
  /** 行の絞り込み欄の開閉。初期状態は閉(条件があるときはボタンの件数バッジで分かる、計画Issue #266) */
  const [rowFilterOpen, setRowFilterOpen] = useState(false)
  /** 上部に固定するタブ・絞り込み欄の容器と、その高さ(一括設定の領域の top に使う、計画Issue #266) */
  const [stickyElement, setStickyElement] = useState<HTMLDivElement | null>(null)
  const stickyHeight = useElementHeight(stickyElement)
  /** 表の横スクロールの枠。一括設定のバナーの出入りで表が上下にずれる分を、ページのスクロールで補正する位置の基準にする(計画Issue #266) */
  const [importRegion, setImportRegion] = useState<HTMLDivElement | null>(null)
  /** 本物の表。見出しの複製を固定する判断と、列幅の複製に使う(計画Issue #266) */
  const [importTable, setImportTable] = useState<HTMLTableElement | null>(null)
  /** 開始状態に出す一時保存の一覧(計画Issue #231 フェーズ3)。取込先の科目ごとに1つ */
  const [drafts, setDrafts] = useState<StatementImportDraftSummary[]>([])
  /** いま開いている取込が、再開した(または保存した)一時保存のid。同じ取込先への保存し直しは、これなら確認なしで上書きする */
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null)
  /** 「一時保存しました」の通知 */
  const [draftMessage, setDraftMessage] = useState('')
  /** 再開した直後の通知。保存日時と、削除された参照先などで戻せなかった行の数 */
  const [draftNotice, setDraftNotice] = useState<{ savedAt: string; dropped: number } | null>(null)
  /** 保存時のマッピング定義で読めなかった一時保存。定義を作り直すと、保存した取込先・入力を戻して続ける */
  const [staleDraft, setStaleDraft] = useState<StatementImportDraft | null>(null)
  /** 一時保存の上書き・破棄の確認 */
  const [draftDialog, setDraftDialog] = useState<
    { kind: 'overwrite'; accountName: string; savedAt: string; resolve: (ok: boolean) => void } | { kind: 'discard'; id: number } | null
  >(null)
  /** 再開した一時保存の、行ごとの入力(外部取引ID → 保存した入力)。チェックを戻して現れた行にも重ねる */
  const draftInputsRef = useRef<Record<string, StatementImportDraftRowInput>>({})
  /** 一時保存した時点の行の状態(外部取引ID → 状態)。これと同じ状態の行は、未保存の編集とみなさない */
  const draftSavedStates = useRef(new Map<string, ImportRowState>())
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
  /** 直近の確定で、操作履歴の取込の操作に添える情報(確定の結果から作る。計画Issue #295) */
  const confirmMetaRef = useRef<OperationMeta | undefined>(undefined)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // 明細の範囲選択の基点。選択対象(表示中の行)は、読み込み前の早期 return のあとで決まるため、基点だけをここ(早期 return の前)で持つ
  const rangeAnchor = useRangeAnchor<number>()
  /** タブ見出しと一覧のまとまり。ページを送ったときに、先頭までスクロールする目印 */
  const tabsRef = useRef<HTMLDivElement>(null)
  const [bulkMessage, setBulkMessage] = useState('')
  // Esc で明細の選択をすべて解除する(一括設定のバナーの「選択を解除」と同じ。計画Issue #235 D)
  useEscapeToClear(
    selected.size > 0
      ? () => {
          setSelected(new Set())
          setBulkMessage('')
        }
      : null,
  )
  /** 一括編集のバーで選んだ項目(計画Issue #300)。「N行に適用」を押すまで行には反映されない。選択が空になったら「変更しない」に戻す */
  const [bulkPick, setBulkPick] = useState<ImportBulkPick>(EMPTY_IMPORT_BULK_PICK)
  useEffect(() => {
    if (selected.size === 0) setBulkPick(EMPTY_IMPORT_BULK_PICK)
  }, [selected.size])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [doneMessage, setDoneMessage] = useState('')
  /** 確定できなかった行の番号 → エラーの種類。該当行の直下に出す(計画Issue #263) */
  const [rowErrors, setRowErrors] = useState<Record<number, RowErrorKind>>({})
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null)
  const [createTarget, setCreateTarget] = useState<CreateTarget>(null)
  const [defaultAccountCreate, setDefaultAccountCreate] = useState<DefaultAccountCreate>(null)
  /** 開いているキーワードのポップアップ(計画Issue #207・#259)。登録済みのキーワードは開くたびにDBから読み込む */
  const [settings, setSettings] = useState<SettingsView | null>(null)
  /** 「N行に適用」を押した結果(開いているポップアップに出す) */
  const [settingsMessage, setSettingsMessage] = useState('')
  /** ポップアップでの保存に失敗したときの表示 */
  const [settingsSaveError, setSettingsSaveError] = useState('')
  /** 「N行を上書き」の確認待ち(計画Issue #291)。確認までは行を書き換えない。確認の間にポップアップが閉じても、対象を覚えておく */
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    view: SettingsView
    item: KeywordListItem
    /** 取引先のキーワードなら取引先の名前、科目のキーワードなら科目の名前 */
    name: string
    count: number
    /** 書き換わる行のうち、すでに取引先か相手科目が入っている行の数 */
    filled: number
  } | null>(null)
  /** 保存中のキーワード(入力を終えたときのフォーカス外れとEnterで二重に保存しないため) */
  const savingKeys = useRef(new Set<string>())
  /** 閉じる操作での保存が、保存を待つ間に開いた別のポップアップを閉じないよう、最新の「開いているポップアップ」を持つ */
  const settingsRef = useRef<SettingsView | null>(null)
  settingsRef.current = settings
  /**
   * 全キーワードルール。行のアイコンの強調とツールチップに、ポップアップを開く前の一致を出す(計画Issue #259)。
   * ポップアップでキーワードを保存・削除するたびに読み直す
   */
  const [allRules, setAllRules] = useState<KeywordRule[]>([])
  const refreshRules = async () => setAllRules(await Promise.resolve(keywordRuleRepository.findAll()))
  useEffect(() => {
    void refreshRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordRuleRepository])
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

  // 開始状態に出す一時保存の一覧(計画Issue #231 フェーズ3)
  useEffect(() => {
    void refreshDrafts()
  }, [statementImportDraftRepository]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 未保存の警告(計画Issue #193、#293で編集の有無を問わない判定に変更)。取り込める行(重複・取り込まない行を除く)が、
  // 確定も一時保存もされずに残っているとき。CSVを選んだ直後(未編集)でも出す。
  // 一時保存した状態と同じ行は、失うものが無いので対象外(計画Issue #231 フェーズ3)
  const hasUnsavedEdits =
    session !== null &&
    hasUnsavedRows({
      records: session.review.records,
      rows: session.rows,
      done: session.done,
      savedStates: draftSavedStates.current,
    })
  // 保存の操作は「一時保存して移動」だけ(何も確定せず、すべての入力を一時保存してから移動する。計画Issue #293で「保存して移動」と説明文を廃止)
  const unsavedDialog = useUnsavedEditGuard({
    dirty: hasUnsavedEdits,
    extraAction: { label: t('draftSaveAndLeave'), run: () => saveDraft() },
  })
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

  const updateRow = (index: number, update: (state: ImportRowState) => ImportRowState) => {
    // 直したことが分かるよう、その行のエラーは入力を変えた時点で消す(計画Issue #263)
    setRowErrors((prev) => {
      if (prev[index] === undefined) return prev
      const { [index]: _removed, ...rest } = prev
      return rest
    })
    setSession((prev) =>
      prev === null ? prev : { ...prev, rows: prev.rows.map((state, i) => (i === index ? update(state) : state)) },
    )
  }

  const keywordOf = (text: string) => normalizeDescriptionForMatching(text)
  /** 取引先を持てる(費用・収益の)科目か。キーワードに紐づける科目はこの科目だけ */
  const isPlAccountId = (accountId: number | null): accountId is number => {
    const category = accountList.find((a) => a.id === accountId)?.category
    return category !== undefined && isCounterpartyEligibleCategory(category)
  }

  /**
   * この行に一致したキーワード(アイコンの強調とツールチップに使う)。取引先側は、その行の取引先を持つキーワード、
   * 科目側は、取引先なしでその行の相手科目を持つキーワード(計画Issue #259)
   */
  function matchedRulesOf(state: ImportRowState, description: string, kind: 'counterparty' | 'account'): KeywordRule[] {
    return allRules.filter((rule) => {
      if (!matchesKeyword(rule.pattern, description)) return false
      return kind === 'counterparty'
        ? state.counterpartyId !== null && rule.counterpartyId === state.counterpartyId
        : state.counterAccountId !== null && rule.counterpartyId === null && rule.accountId === state.counterAccountId
    })
  }

  /** 開いているキーワードのポップアップの一覧(登録済み → 入力中)。この行に一致するキーワードには印を付ける */
  function settingsItems(view: SettingsView): KeywordListItem[] {
    if (!session) return []
    const description = records[view.index].record.description
    const descriptions = visibleIndices.map((i) => records[i].record.description)
    const entries: { key: string; kind: 'registered' | 'new'; text: string; accountId: number | null }[] = [
      ...view.registered.map((r) => ({ key: r.key, kind: 'registered' as const, text: r.text, accountId: r.accountId })),
      ...view.typing.map((k) => ({ key: k.key, kind: 'new' as const, text: k.text, accountId: k.accountId })),
    ]
    return entries.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      text: entry.text,
      accountId: entry.accountId,
      matched: matchesKeyword(entry.text, description),
      count: countRowsContaining(entry.text, descriptions),
      // 入力を終えたときの検証の結果を出す
      error: view.errors[entry.key] ?? null,
    }))
  }

  /**
   * キーワードのポップアップを開く(計画Issue #259)。取引先側は、その取引先のキーワード(キーワードごとに科目つき)。
   * 科目側は、取引先なしでその科目を持つキーワード(PL・BSを問わない。取引先つきのキーワードは取引先側で編集する)。
   * 登録済みのキーワードは開くたびにDBから読み込む。開いている同じポップアップをもう一度押すと閉じる
   */
  async function toggleSettings(index: number, kind: 'counterparty' | 'account') {
    if (!session) return
    const state = session.rows[index]
    const counterpartyId = kind === 'counterparty' ? state.counterpartyId : null
    const accountId = kind === 'account' ? state.counterAccountId : null
    if (counterpartyId === null && accountId === null) return
    if (settings?.index === index && settings.counterpartyId === counterpartyId && settings.accountId === accountId) {
      void closeSettings()
      return
    }
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
    const found = await Promise.resolve(
      counterpartyId !== null ? keywordRuleRepository.findByCounterparty(counterpartyId) : keywordRuleRepository.findByAccount(accountId!),
    )
    // 科目側は、取引先なしのキーワードだけ(取引先つきのキーワードは取引先側で編集する)
    const registered = counterpartyId !== null ? found : found.filter((rule) => rule.counterpartyId === null)
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
  const isSameView = (a: SettingsView, b: SettingsView) =>
    a.index === b.index && a.counterpartyId === b.counterpartyId && a.accountId === b.accountId

  function changeKeywordText(key: string, text: string) {
    if (!settings) return
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
   * キーワード1件を保存する。入力を終えたとき(フォーカスを外す・Enter)と、閉じる操作から呼ぶ。1文字ごとには保存しない
   * (途中の文字列がキーワードとして登録され、ほかの行に誤って当たるのを避けるため)。問題があれば保存せずその場に出す。
   * 保存の必要がない(変更なし・入力前の空欄)か保存できたらtrue、問題があって保存できなかったらfalse。
   * 同じキーワードを同時に二重に保存しない(フォーカス外れと閉じる操作が重なっても1回だけ)。
   */
  async function saveKeyword(view: SettingsView, key: string): Promise<boolean> {
    if (savingKeys.current.has(key)) return true
    const registered = view.registered.find((r) => r.key === key)
    const typing = view.typing.find((k) => k.key === key)
    const text = registered?.text ?? typing?.text
    if (text === undefined) return true
    if (registered && text === registered.savedText) return true
    if (typing && text.trim() === '') {
      // 入力前の空欄は、何もせず取り除く
      withSettings((v) => ({ ...v, typing: v.typing.filter((k) => k.key !== key) }))
      return true
    }
    const items = settingsItems(view)
    const error = validateKeyword({
      text,
      otherTexts: items.filter((item) => item.key !== key).map((item) => item.text),
    })
    if (error !== null) {
      withSettings((v) => ({ ...v, errors: { ...v.errors, [key]: error } }))
      return false
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
            // 科目側のキーワードは、開いている科目に結び付ける
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
      void refreshRules()
      return true
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
      return false
    } finally {
      savingKeys.current.delete(key)
    }
  }

  function commitKeyword(key: string) {
    if (settings) void saveKeyword(settings, key)
  }

  /**
   * 閉じる操作(閉じるボタン・Esc・外側クリック。計画Issue #259)。入力中の内容(フォーカスを外す前のもの)を先に保存してから閉じる。
   * 保存できない入力(同じキーワードなど)があるときは閉じずに、その場に問題を出す。
   */
  async function closeSettings() {
    const view = settingsRef.current
    if (view === null) return
    const keys = [...view.registered.filter((r) => r.text !== r.savedText).map((r) => r.key), ...view.typing.map((k) => k.key)]
    let ok = true
    for (const key of keys) if (!(await saveKeyword(view, key))) ok = false
    const current = settingsRef.current
    // 保存を待つ間に別のポップアップが開いていたら、そちらは閉じない
    if (ok && current !== null && isSameView(current, view)) setSettings(null)
  }

  async function deleteKeyword(key: string) {
    if (!settings) return
    const registered = settings.registered.find((r) => r.key === key)
    if (!registered) {
      withSettings((view) => clearError({ ...view, typing: view.typing.filter((k) => k.key !== key) }, key))
      return
    }
    setSettingsSaveError('')
    try {
      await Promise.resolve(keywordRuleRepository.delete(registered.id))
      withSettings((view) => clearError({ ...view, registered: view.registered.filter((r) => r.key !== key) }, key))
      void refreshRules()
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    }
  }

  /**
   * 「キーワードを追加」。その行の摘要を初期値として入れる。自動では登録せず、入力を終えたとき・閉じるときに
   * 明示的に追加したものとして保存する(計画Issue #259。摘要の自動学習は廃止した)
   */
  function addKeyword() {
    if (!settings) return
    const initialText = formatDescriptionForDisplay(records[settings.index].record.description)
    withSettings((view) => {
      // 取引先のキーワードの科目の初期値は、その取引先のキーワードで最も多く使われている科目(費用・収益のみ。同数なら指定なし。
      // 計画Issue #236)。科目側のキーワードは開いている科目に固定なので、ここでは決めない
      const defaultAccountId =
        view.counterpartyId === null
          ? null
          : mostFrequentAccountId([...view.registered, ...view.typing].map((k) => (k.accountId !== null && isPlAccountId(k.accountId) ? k.accountId : null)))
      return { ...view, typing: [...view.typing, { key: `t${view.nextKey}`, text: initialText, accountId: defaultAccountId }], nextKey: view.nextKey + 1 }
    })
  }

  /**
   * キーワードの科目を選んだ時点で保存する(計画Issue #219)。入力中のキーワードは、入力を終えて保存するときに
   * 科目も一緒に保存する。
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
    // 直前の「N行に適用」の結果が、今回の変更の結果として残らないようにする
    setSettingsMessage('')
    try {
      await Promise.resolve(keywordRuleRepository.update(registered.id, { accountId }))
      void refreshRules()
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
          followOnly: true,
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
        followOnly: true,
      }).applied
      if (followed > 0) setSettingsMessage(t('defaultAccountFollowed', { count: followed }))
    } catch {
      setSettingsSaveError(t('settingsSaveError'))
    }
  }

  /**
   * キーワード1件を、取り込み中のほかの行へ適用したときの結果(画面上だけの計算。DBには書かない)。
   * 件数の表示と適用の実行が食い違わないよう、同じ関数で数える。入れるのは、そのキーワードを含み、取引先
   * (科目側のキーワードなら相手科目)が未入力で、手で触っていない行。この行自身は入力済みなので含まない
   */
  function keywordApplyResult(view: SettingsView, item: KeywordListItem, overwrite = false) {
    if (!session) return null
    if (item.error !== null || item.text.trim() === '') return null
    const common = {
      states: session.rows,
      initialStates: session.initialRows,
      records,
      descriptions: records.map((r) => r.record.description),
      done: session.done,
      accounts: accountList,
    }
    // 上書きは、入力済みの行も対象にする。ポップアップを開いた行は、自分で入力・確認しているので対象にしない(計画Issue #291)
    const overwriteOptions = overwrite ? { overwrite: true, excludeIndex: view.index } : {}
    if (view.counterpartyId === null) {
      return view.accountId === null
        ? null
        : applyAccountKeywordsToRows({ ...common, settings: { accountId: view.accountId, keywords: [item.text] }, ...overwriteOptions })
    }
    return applyCounterpartySettingsToRows({
      ...common,
      settings: { counterpartyId: view.counterpartyId, keywords: [{ text: item.text, accountId: item.accountId ?? null }] },
      fillOnly: !overwrite,
      ...overwriteOptions,
    })
  }

  /** 「N行を上書き」を押したとき。確認ダイアログを出す(押しただけでは行を書き換えない。計画Issue #291) */
  function requestKeywordOverwrite(view: SettingsView, item: KeywordListItem, name: string) {
    if (!session) return
    const result = keywordApplyResult(view, item, true)
    if (result === null || result.applied === 0) return
    setOverwriteConfirm({ view, item, name, count: result.applied, filled: countFilledRowsOverwritten(session.rows, result.states) })
  }

  /** 確認で「上書きする」を押したとき。確認の間に行が変わりうるので、その時点の行に対して計算し直す */
  function confirmKeywordOverwrite() {
    const target = overwriteConfirm
    setOverwriteConfirm(null)
    if (!session || target === null) return
    const result = keywordApplyResult(target.view, target.item, true)
    if (result === null) return
    setSession({ ...session, rows: result.states, initialRows: result.initialStates })
    setSettingsMessage(result.applied > 0 ? t('overwriteDone', { count: result.applied }) : t('overwriteNone'))
  }

  function applyKeywordToOtherRows(view: SettingsView, item: KeywordListItem) {
    if (!session) return
    const result = keywordApplyResult(view, item)
    if (result === null) return
    setSession({ ...session, rows: result.states, initialRows: result.initialStates })
    setSettingsMessage(result.applied > 0 ? t('applyDone', { count: result.applied }) : t('applyNone'))
  }

  /**
   * キーワードの行ごとの「適用」「上書き」の2つのアイコンボタン(計画Issue #259・#291)。アイコンの横に件数を出し、
   * 0行なら無効にして、理由をaria-labelとツールチップに出す。適用は未入力の行だけ、上書きは入力済みの行も対象にする
   */
  function renderKeywordApply(view: SettingsView, name: string) {
    return (item: KeywordListItem) => {
      const count = keywordApplyResult(view, item)?.applied ?? 0
      const overwriteCount = keywordApplyResult(view, item, true)?.applied ?? 0
      // ホバーの説明は、何を更新するボタンかだけを短く伝える。件数はボタンの表示とaria-label、書き換える内容は上書きの確認ダイアログにある
      // 適用は未入力の行だけが対象なので、0行のときは「未入力の行はありません」。含む行そのものが無いのは、上書き(右)のほうで伝える
      const title = count === 0 ? t('applyKeywordNoneUnfilledTitle') : t('applyKeywordTitle')
      const applyLabel = count === 0 ? t('applyKeywordNone') : t('applyKeywordCount', { count })
      const overwriteLabel = overwriteCount === 0 ? t('overwriteKeywordNone') : t('overwriteKeywordCount', { count: overwriteCount })
      return (
        <>
          <button
            type="button"
            className="import-kw-btn"
            disabled={count === 0}
            aria-label={applyLabel}
            title={title}
            onClick={() => applyKeywordToOtherRows(view, item)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="import-icon">
              <path d="M8 2.5v7M5 6.8l3 3 3-3M3 13h10" />
            </svg>
            <span aria-hidden="true">{count}</span>
          </button>
          <button
            type="button"
            className="import-kw-btn import-kw-btn--danger"
            disabled={overwriteCount === 0}
            aria-label={overwriteLabel}
            title={overwriteCount === 0 ? t('overwriteKeywordNoneTitle') : t('overwriteKeywordTitle')}
            onClick={() => requestKeywordOverwrite(view, item, name)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="import-icon">
              <path d="M3.2 7a5 5 0 0 1 9-1.7M12.6 2.6v2.8H9.8M12.8 9a5 5 0 0 1-9 1.7M3.4 13.4v-2.8h2.8" />
            </svg>
            <span aria-hidden="true">{overwriteCount}</span>
          </button>
        </>
      )
    }
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
    // 取引先の候補が複数ある行があるときだけ、候補の並びに使う使用件数と名前を用意する(計画Issue #236)
    const hasMultipleCandidates = [...rulesByText.values()].some(
      (rules) => new Set(rules.flatMap((rule) => (rule.counterpartyId === null ? [] : [rule.counterpartyId]))).size > 1,
    )
    const usageByCounterparty = new Map<number, number>(
      hasMultipleCandidates
        ? (await Promise.resolve(counterpartyRepository.countJournalLinesByCounterparty?.() ?? [])).map((u) => [u.counterpartyId, u.count] as const)
        : [],
    )
    const counterpartyNames = new Map((data?.counterparties ?? []).map((c) => [c.id, c.name] as const))
    const accountNames = new Map(accounts.map((a) => [a.id, a.name] as const))
    return review.records.map((r) => {
      const estimate = estimateKeywordRule(r.record.description, ruleLookup)
      const counterpartyId = estimate.counterpartyId
      // 相手科目は、ルールが科目を持てばその科目、なければ取引先の既定の科目(docs/domain/statement-import.md 1.5)
      const counterAccountId = estimate.accountId
      // 曖昧な行(独立したキーワードが重なり、別々の取引先・科目に解決される。計画Issue #260)だけ、取引先・相手科目とも
      // 一致した候補を選択欄の先頭に並べる(選ぶのは利用者。自動では割り当てない)。取引先は、一致したキーワードが長い順 →
      // 過去の使用件数が多い順 → 名前の五十音順、相手科目は、一致したキーワードが長い順 → 名前の五十音順
      const rules = estimate.ambiguous ? (rulesByText.get(normalizeDescriptionForMatching(r.record.description)) ?? []) : []
      return createInitialRowState({
        counterpartyId: resolveEligibleCounterpartyId(counterpartyId, counterAccountId, accounts),
        counterAccountId,
        candidateCounterpartyIds: rankCounterpartyCandidates({
          rules,
          usageCountOf: (id) => usageByCounterparty.get(id) ?? 0,
          nameOf: (id) => counterpartyNames.get(id) ?? '',
        }),
        candidateAccountIds: rankAccountCandidates({ rules, nameOf: (id) => accountNames.get(id) ?? '' }),
      })
    })
  }

  /**
   * 取込先とチェックしたファイルから、取り込む一覧を作る。チェックしたファイルが無ければ一覧は出さない。
   * resumeを渡すと、一時保存の再開(計画Issue #231 フェーズ3): いまの帳簿で重複・似た取引・残高を計算し直した初期値の上に、
   * 保存した入力(外部取引IDごと)を重ねる
   */
  async function buildSession(
    account: Account,
    next: MultiFileMappingMatch,
    checked: ReadonlySet<string>,
    restoreRows = false,
    resume?: { savedAt: string },
  ) {
    const files = next.files.filter((f) => checked.has(f.fileName))
    // ファイルのチェックの切り替えによる作り直し(restoreRows)では、開いているタブとページを保つ。それ以外は新しい取込なので初期化する
    if (!restoreRows) {
      setActiveTab('new')
      setPages({ new: 1, duplicate: 1 })
      setSort(null)
      setRowFilterInput(EMPTY_FILTER_INPUT)
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
    // 再開した一時保存の入力(draftInputsRef)を、記憶の無い行に重ねる。削除された参照先を指す入力は戻さず、戻せなかった行を数える
    const selectableAccounts = data!.accounts.filter(
      (a) => a.isActive && a.id !== account.id && isStatementImportCounterAccountEligible(a),
    )
    const valid = {
      accountIds: new Set(selectableAccounts.map((a) => a.id)),
      counterpartyIds: new Set(data!.counterparties.filter((c) => c.isActive).map((c) => c.id)),
      projectIds: new Set(data!.projects.filter((p) => p.isActive).map((p) => p.id)),
      memberIds: new Set(data!.members.map((m) => m.id)),
      batchIds: new Set(data!.batches.map((b) => b.id)),
    }
    let droppedRows = 0
    const overlaid = (row: ImportRowState, i: number): ImportRowState => {
      const saved = restoreRows || resume ? draftInputsRef.current[review.records[i].externalId] : undefined
      if (saved === undefined) return row
      const applied = applyDraftRowInput({ computed: row, saved, record: review.records[i], accounts: data!.accounts, valid })
      if (applied.dropped) droppedRows++
      return applied.state
    }
    const rows = computedRows.map((row, i) => remembered(i)?.state ?? overlaid(row, i))
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
    if (resume) {
      // 再開した直後の入力は保存済みなので、未保存の編集とみなさない。再開した旨と、戻せなかった行の数を知らせる
      draftSavedStates.current = new Map(review.records.map((r, i) => [r.externalId, rows[i]]))
      setDraftNotice({ savedAt: resume.savedAt, dropped: droppedRows })
    }
    setSelected(new Set())
    setBulkMessage('')
    setSettings(null)
    setSettingsMessage('')
    setSettingsSaveError('')
  }

  /** 一時保存に関する画面の状態を、取込の始め直し(CSVの選び直し・取込先の変更・確定の完了)で初期に戻す */
  function resetDraftState() {
    setCurrentDraftId(null)
    setDraftMessage('')
    setDraftNotice(null)
    setStaleDraft(null)
    draftInputsRef.current = {}
    draftSavedStates.current = new Map()
  }

  /** 開始状態の一時保存の一覧を、DBから読み直す */
  async function refreshDrafts() {
    setDrafts(await Promise.resolve(statementImportDraftRepository.findSummaries()))
  }

  /** ファイルごとの期間・件数(チェックの有無によらず、期間の早い順) */
  function summarizeFiles(next: MultiFileMappingMatch): MultiFileSummary[] {
    return buildMultiFileStatementImportReview({
      files: next.files,
      definition: next.definition,
      existingExternalIds: new Set(),
      existingTransactions: [],
      approximateDuplicateOptions: approximateDuplicateOptions ?? DEFAULT_APPROXIMATE_DUPLICATE_OPTIONS,
    }).files
  }

  /**
   * 一時保存を保存する(計画Issue #231 フェーズ3)。CSVの生データ・定義・取込先・取り込むファイルのチェック・誰の明細か・
   * 初期値から変えた行の入力を、取込先の科目ごとの一時保存へ書く。確定はしない。
   * 別の取込の一時保存が同じ取込先にあるときは、上書きの確認を出す(再開した一時保存への保存は確認なし)。
   * 保存できたときだけtrueを返す
   */
  async function saveDraft(): Promise<boolean> {
    if (!session) return false
    const done = session.done
    const account = session.targetAccount
    try {
      const existing = await Promise.resolve(statementImportDraftRepository.findByAccountId(account.id))
      if (existing !== null && existing.id !== currentDraftId) {
        const confirmed = await new Promise<boolean>((resolve) =>
          setDraftDialog({ kind: 'overwrite', accountName: account.name, savedAt: existing.updatedAt, resolve }),
        )
        setDraftDialog(null)
        if (!confirmed) return false
      }
      setBusy(true)
      const remaining = visibleIndices.filter((i) => !done.has(i) && statusOf(i) !== 'duplicate' && statusOf(i) !== 'skipped')
      const saved = await Promise.resolve(
        statementImportDraftRepository.save({
          targetAccountId: account.id,
          definitionId: session.definition.id,
          ownerMemberId: ownerChoice?.accountId === account.id ? ownerChoice.memberId : null,
          files: csvs.map((c) => ({ fileName: c.fileName, bytes: c.bytes, isChecked: checkedFiles.has(c.fileName) })),
          rowInputs: collectDraftRowInputs({
            externalIds: session.review.records.map((r) => r.externalId),
            rows: session.rows,
            initialRows: session.initialRows,
            done,
            memory: rowMemory.current,
          }),
          totalRows: remaining.length,
          filledRows: remaining.filter((i) => statusOf(i) === 'new').length,
        }),
      )
      setCurrentDraftId(saved.id)
      draftSavedStates.current = new Map(session.review.records.map((r, i) => [r.externalId, session.rows[i]]))
      setDraftMessage(t('draftSaved', { time: formatDraftSavedAt(saved.updatedAt), account: account.name }))
      setError('')
      await refreshDrafts()
      return true
    } catch {
      setError(t('draftSaveError'))
      return false
    } finally {
      setBusy(false)
    }
  }

  /** 保存した取込先・入力で続ける。保存時の定義で読めたときと、定義を作り直したときの、共通の続き */
  async function continueFromDraft(next: MultiFileMappingMatch, draft: StatementImportDraft) {
    const account = data!.accounts.find((a) => a.id === draft.targetAccountId)
    if (!account) throw new Error('target account of the draft is missing')
    const checked = new Set(
      draft.files.filter((f) => f.isChecked && next.files.some((n) => n.fileName === f.fileName)).map((f) => f.fileName),
    )
    setMatch(next)
    setCheckedFiles(checked)
    setFileSummaries(summarizeFiles(next))
    setTargetAccountId(account.id)
    if (draft.ownerMemberId !== null && account.householdMemberId === null) {
      setOwnerChoice({ accountId: account.id, memberId: draft.ownerMemberId })
    }
    setCurrentDraftId(draft.id)
    setStaleDraft(null)
    draftInputsRef.current = draft.rowInputs
    await buildSession(account, next, checked, false, { savedAt: draft.updatedAt })
  }

  /** 開始状態の一覧から、一時保存を再開する。CSVは選び直さず、保存したCSVを読み込み直す */
  async function resumeDraft(id: number) {
    const draft = await Promise.resolve(statementImportDraftRepository.findById(id))
    if (draft === null || draft.files.length === 0) {
      setError(t('draftNotFound'))
      await refreshDrafts()
      return
    }
    setBusy(true)
    setError('')
    setDoneMessage('')
    setRowErrors({})
    setConfirmResult(null)
    rowMemory.current.clear()
    resetDraftState()
    setSession(null)
    setMatch(null)
    setCandidates([])
    setNoMatch(false)
    setTargetAccountId(null)
    try {
      const loaded: LoadedCsv[] = draft.files.map((f) => ({ fileName: f.fileName, bytes: f.bytes }))
      setCsvs(loaded)
      setCsv(loaded[0])
      const definitions = await Promise.resolve(importMappingDefinitionRepository.findAll())
      setInstitutionNames(collectFinancialInstitutionNames(definitions.map((d) => d.formatGroupId)))
      setAllDefinitions(definitions)
      const definition = definitions.find((d) => d.id === draft.definitionId)
      const matches = definition ? resolveMultiFileMappingCandidates(loaded, [definition]) : []
      if (matches.length === 0) {
        // 保存時の定義が削除・編集されて読めない。CSVと入力は一時保存に残し、定義の作り直しへ案内する
        setNoMatch(true)
        setStaleDraft(draft)
        setCurrentDraftId(draft.id)
        return
      }
      await continueFromDraft(matches[0], draft)
    } catch {
      setError(t('uploadError'))
    } finally {
      setBusy(false)
    }
  }

  /** 一時保存を破棄する(確認のあと)。開いていたものなら、画面は開始状態に戻る */
  async function discardDraft(id: number) {
    try {
      await Promise.resolve(statementImportDraftRepository.delete(id))
      if (currentDraftId === id || staleDraft?.id === id) clearImportScreen()
      await refreshDrafts()
    } catch {
      setError(t('draftSaveError'))
    }
  }

  /** 画面を取り込み前の状態(CSVの選択)に戻す。全件を確定したとき・開いていた一時保存を破棄したときに使う */
  function clearImportScreen() {
    rowMemory.current.clear()
    resetDraftState()
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
  }

  /** 定義が決まったら、紐づく科目(取込先に選べるもの)が1つならそれを取込先にして取り込む。無い・複数なら選ばせる */
  async function selectMatch(next: MultiFileMappingMatch) {
    setMatch(next)
    setSession(null)
    const everyFile = new Set(next.files.map((f) => f.fileName))
    setCheckedFiles(everyFile)
    // ファイルの期間・件数(チェックの有無によらず、期間の早い順)
    setFileSummaries(summarizeFiles(next))
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
    setRowErrors({})
    setConfirmResult(null)
    rowMemory.current.clear()
    resetDraftState()
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
    resetDraftState()
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
    // 一時保存の再開で定義が読めなかったときは、作り直した定義で、保存した取込先と入力を戻して続ける(計画Issue #231 フェーズ3)
    if (staleDraft !== null) {
      await continueFromDraft(matches[0], staleDraft)
      return
    }
    await selectMatch(matches[0])
  }

  const records = session?.review.records ?? []
  // 行は「新規」「重複」のタブに分ける(計画Issue #263)。「新規」は似た取引の行を先頭に寄せる。タブの中は、ヘッダーで並び替えて
  // いなければ取り込んだ順のまま、並び替えていればヘッダーを押した時点の値の順(計画Issue #231 フェーズ2)。保存時の並び(rowOrder)は、どちらでも元の順を使う
  const compareRows = (a: number, b: number) => compareBySort(sort, records[a], records[b]) || a - b
  const remainingIndices = session ? records.map((_, i) => i).filter((i) => !session.done.has(i)) : []
  const tabIndices = session ? buildTabIndices(remainingIndices, records, session.rows, compareRows) : { new: [], duplicate: [] }
  const visibleIndices = [...tabIndices.new, ...tabIndices.duplicate]
  const statusOf = (i: number) => rowStatus(records[i], session!.rows[i])
  /** 絞り込みパネルの入力(選択欄の値)を、判定に使う条件(グループは配下の項目のidに展開)にしたもの(計画Issue #258) */
  const filterCategories = {
    counterAccount: categories.counterAccounts,
    counterparty: categories.counterparties,
    project: categories.projects,
    member: memberFilterCategories(data.members),
    batch: batchFilterCategories(data.batches),
  }
  const rowFilter = resolveFilterInput(rowFilterInput, filterCategories)
  /** 行が絞り込みの条件に合うか(計画Issue #258)。重複の行は入力欄を持たないので、科目などの条件には合わない */
  const matchesFilterWith = (filter: ImportRowFilter, i: number) =>
    matchesRowFilter(filter, {
      description: formatDescriptionForDisplay(records[i].record.description),
      entryDate: records[i].record.entryDate,
      amount: records[i].record.amount,
      inputs:
        statusOf(i) === 'duplicate'
          ? null
          : {
              counterAccountId: session!.rows[i].counterAccountId,
              counterpartyId: session!.rows[i].counterpartyId,
              projectId: session!.rows[i].projectId,
              // 画面に出しているメンバー: 科目に既定のメンバーがあればそのメンバー、無ければ行で選んだメンバー
              memberId: defaultMemberIdOf(session!.rows[i].counterAccountId, accountList) ?? session!.rows[i].householdMemberId,
              // 精算バッチは、立替金・未払金の行だけが持つ(それ以外の行は、画面にも出さない)
              batchId: isTaggableAccountId(session!.rows[i].counterAccountId, accountList) ? session!.rows[i].settlementBatchId : null,
            },
    })
  const rowFilterActive = isRowFilterActive(rowFilter)
  const matchesFilter = (i: number) => !rowFilterActive || matchesFilterWith(rowFilter, i)
  const importable = visibleIndices.filter((i) => statusOf(i) !== 'duplicate' && statusOf(i) !== 'skipped')
  /** 確定の対象。絞り込み中は表示中の行だけ、条件が無いときは取り込み対象の全件(計画Issue #258) */
  const confirmTargets = rowFilterActive ? importable.filter(matchesFilter) : importable
  const skippedCount = visibleIndices.filter((i) => statusOf(i) === 'skipped').length
  const dupCount = visibleIndices.length - importable.length - skippedCount
  const similarCount = importable.filter((i) => rowGroup(records[i]) === 'similar').length
  /** タブ見出しの件数と状態の札。ほかのタブの行は見えないので、確認の漏れに気づけるよう見出しに出す(計画Issue #263) */
  const tabSummary = session
    ? summarizeTabs(remainingIndices, records, session.rows)
    : { newCount: 0, duplicateCount: 0, similarCount: 0, uncheckedCount: 0 }
  const showFileColumn = (session?.review.files.length ?? 0) >= 2
  const unreadableCount = session?.review.unreadableRows.length ?? 0
  /** 読めない行の方が取り込める行より多い(マッピングの取り違えの疑い)。タブの札と、タブの中の先頭の警告に出す */
  const unreadableMajority = session !== null && unreadableCount > records.length
  const rowErrorCount = Object.keys(rowErrors).length
  /** いま開いているタブ。行が無くなったタブ(最後の重複を「取り込む」にしたなど)を開いたままにはしない */
  const shownTab: ImportTabKey =
    (activeTab === 'duplicate' && tabSummary.duplicateCount === 0) || (activeTab === 'unreadable' && unreadableCount === 0)
      ? 'new'
      : visibleIndices.length === 0 && unreadableCount > 0
        ? 'unreadable'
        : activeTab
  const shownRowTab: RowTab = shownTab === 'duplicate' ? 'duplicate' : 'new'
  /** 開いているタブの、絞り込みに合う行(並びは絞り込み前のまま)。条件が無いときはタブの全行 */
  const shownTabIndices = rowFilterActive ? tabIndices[shownRowTab].filter(matchesFilter) : tabIndices[shownRowTab]
  /** 絞り込み中の各タブの、表示中の件数。タブ見出しに「表示中 / 全体」で出す */
  const filteredTabCounts = {
    new: rowFilterActive ? tabIndices.new.filter(matchesFilter).length : tabSummary.newCount,
    duplicate: rowFilterActive ? tabIndices.duplicate.filter(matchesFilter).length : tabSummary.duplicateCount,
  }
  // 入力で行が条件に合わなくなる(「未設定」で絞って科目を入れたなど)と、その行は見えなくなる。見えない行のチェックは外す
  if (rowFilterActive && [...selected].some((i) => !matchesFilter(i))) {
    setSelected(new Set([...selected].filter(matchesFilter)))
  }
  const shownPage = pageRange({ total: shownTabIndices.length, page: pages[shownRowTab], pageSize: IMPORT_PAGE_SIZE })
  /** 表に描く行。いま開いているタブの、いまのページの分だけ(描画だけを区切り、状態と確定の対象は全件のまま) */
  const pageIndices = shownTab === 'unreadable' ? [] : shownTabIndices.slice(shownPage.start, shownPage.end)
  const tabItems: ImportTabItem[] = [
    {
      key: 'new',
      label: t('tabNew'),
      count: filteredTabCounts.new,
      totalCount: rowFilterActive ? tabSummary.newCount : undefined,
      states: [
        ...(rowErrorCount > 0
          ? [{ tone: 'error' as const, text: t('tabStateError', { count: rowErrorCount }) }]
          : tabSummary.similarCount > 0
            ? [{ tone: 'todo' as const, text: t('tabStateSimilar', { count: tabSummary.similarCount }) }]
            : []),
        ...(tabSummary.uncheckedCount > 0
          ? [{ tone: 'todo' as const, text: t('tabStateUnchecked', { count: tabSummary.uncheckedCount }) }]
          : []),
      ],
    },
    ...(tabSummary.duplicateCount > 0
      ? [{
            key: 'duplicate' as const,
            label: t('tabDuplicate'),
            count: filteredTabCounts.duplicate,
            totalCount: rowFilterActive ? tabSummary.duplicateCount : undefined,
            muted: true,
          }]
      : []),
    ...(unreadableCount > 0
      ? [
          {
            key: 'unreadable' as const,
            label: t('tabUnreadable'),
            count: unreadableCount,
            muted: !unreadableMajority,
            states: unreadableMajority ? [{ tone: 'warning' as const, text: t('tabStateUnreadableWarning') }] : [],
          },
        ]
      : []),
  ]
  /** 日付・金額を読めず、取り込まない行の一覧(3つ目のタブの内容)。読めない行の方が多いときの警告を、先頭に出す */
  const unreadablePanel = session ? (
    <section aria-label={t('unreadableTitle', { count: unreadableCount })} className="import-panel import-unreadable-panel">
      {unreadableMajority && <p className="import-error">{t('unreadableMajorityWarning')}</p>}
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
  ) : null
  /** タブを切り替える。選択は表示中の行だけが対象なので、見えなくなる行の選択は外す(一括設定が見えない行に及ばないように) */
  const selectTab = (key: ImportTabKey) => {
    if (key === shownTab) return
    setActiveTab(key)
    clearSelection()
  }
  const goToPage = (page: number) => {
    setPages((prev) => ({ ...prev, [shownRowTab]: page }))
    clearSelection()
    tabsRef.current?.scrollIntoView?.({ block: 'start' })
  }
  const clearSelection = () => {
    setSelected(new Set())
    setBulkMessage('')
    rangeAnchor.anchorRef.current = null
  }
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
  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <SortableHeaderCell
      label={label}
      className={className}
      direction={sort?.key === key ? sort.direction : null}
      onSort={() => setSort((prev) => cycleSort(prev, key, toSortableRows()))}
    />
  )
  /**
   * 行へ移る。行のあるタブとページを先に開いて描画してから、スクロールして強調する(計画Issue #263)。
   * rowsを渡すと、その状態になったあとの行の置き場所へ移る(重複の「取り込む」で、行が「新規」へ移ったあとを探すため)
   */
  const jumpToRow = (index: number, rows: readonly ImportRowState[] | undefined = session?.rows) => {
    if (!session || !rows) return
    // 行き先が絞り込みで隠れていると見失うので、移る前に絞り込みを解除する(計画Issue #258)
    if (rowFilterActive) setRowFilterInput(EMPTY_FILTER_INPUT)
    const tabs = buildTabIndices(remainingIndices, records, rows, compareRows)
    const tab: RowTab = tabs.duplicate.includes(index) ? 'duplicate' : 'new'
    const page = Math.floor(tabs[tab].indexOf(index) / IMPORT_PAGE_SIZE) + 1
    if (tab !== shownTab || page !== shownPage.page) {
      flushSync(() => {
        setActiveTab(tab)
        setPages((prev) => ({ ...prev, [tab]: page }))
        clearSelection()
      })
    }
    document.getElementById(`import-row-${index}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    setFlashIndex(index)
    window.setTimeout(() => setFlashIndex((current) => (current === index ? null : current)), 2200)
  }
  /** 確定できなかった行のうち、一覧の先頭に近い行へ移る(エラーの行は、いつも「新規」タブにある) */
  const goToFirstErrorRow = () => {
    const first = tabIndices.new.find((i) => rowErrors[i] !== undefined)
    if (first !== undefined) jumpToRow(first)
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
  /** いま投入できる件数。取り込み対象(全件)のうち、相手科目などが決まっていて確定できる行(ステータスが「新規」)。確定ボタンに「N / 全件」で出す */
  const readyCount = confirmTargets.filter((i) => statusOf(i) === 'new').length
  /** 絞り込みの入力を変える。条件が変わると1ページ目に戻り、見えなくなる行のチェックは外す(外した件数を一括設定の案内に出す) */
  const changeRowFilterInput = (next: ImportFilterInput) => {
    setRowFilterInput(next)
    setPages({ new: 1, duplicate: 1 })
    const nextFilter = resolveFilterInput(next, filterCategories)
    const firstPage = new Set(
      tabIndices[shownRowTab]
        .filter((i) => !isRowFilterActive(nextFilter) || matchesFilterWith(nextFilter, i))
        .slice(0, IMPORT_PAGE_SIZE),
    )
    const { kept, removed } = pruneSelection(selected, (i) => firstPage.has(i))
    setSelected(kept)
    if (removed > 0) setBulkMessage(t('filterSelectionRemoved', { count: removed }))
    rangeAnchor.anchorRef.current = null
  }
  /** 一括編集のバーの「N行に適用」。選んだ項目(選べなくなった項目は除く)を、選択した対象行に反映する(計画Issue #300) */
  const applyBulk = () => {
    if (!session) return
    const result = applyImportBulkPick({
      states: session.rows,
      records,
      selected,
      accounts: accountList,
      pick: sanitizeImportBulkPick(
        bulkPick,
        importBulkRules({ states: session.rows, records, selected, pick: bulkPick, accounts: accountList }),
      ),
    })
    setSession({ ...session, rows: result.states })
    setBulkMessage(
      result.skipped > 0
        ? t('bulkAppliedWithSkipped', { count: result.applied, skipped: result.skipped })
        : t('bulkApplied', { count: result.applied }),
    )
  }

  // 明細の行のチェックの Shift+クリック(範囲選択)・Ctrl/Cmd+クリック(トグル)・Shift+↑↓(計画Issue #235 D)。
  // 範囲は画面に見える順(タブ・ページ・並び替え後)で、表示中のタブの表示中のページの行だけ。重複・保存しない行(チェックなし)は含めない(計画Issue #263)
  const selectableOrder = pageIndices.filter((i) => statusOf(i) !== 'duplicate' && statusOf(i) !== 'skipped')
  const rangeSelection = createRangeSelection(rangeAnchor, {
    order: selectableOrder,
    // 表示中で、チェックのある行(重複・保存しない行・ほかのタブやページの行は除く)だけが、押して切り替えられる
    isSelectable: (index) => selectableOrder.includes(index),
    selected: [...selected],
    onChange: (next) => {
      setBulkMessage('')
      setSelected(new Set(next))
    },
  })
  /** 精算バッチをその場で作る(選択欄の「+ 新しいバッチ」。計画Issue #269)。作ったバッチは画面の候補に足す */
  const createBatch = async (name: string) => {
    const created = await settlementBatchRepository.create({ name, type: 'expense_splitting' })
    setData((prev) => (prev ? { ...prev, batches: [...prev.batches, created] } : prev))
    return created
  }

  /** 見出しのチェック: 表示中のページの行がすべて選ばれているか(全タブ・全ページの行ではない) */
  const allSelected = selectableOrder.length > 0 && selectableOrder.every((i) => selected.has(i))

  /**
   * 取引先をその場で追加する(計画Issue #207)。追加を押した時点で、取引先・キーワード(と、キーワードに紐づける科目)をまとめて保存する。
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

  /** 追加ダイアログのグループ欄から、名前と親グループ(nullなら最上位)でグループをその場で作る(並び順はグループ管理画面で) */
  async function createCounterpartyGroup(name: string, parentGroupId: number | null): Promise<number> {
    const created = await Promise.resolve(counterpartyGroupRepository.create({ name, parentGroupId }))
    setData((prev) => (prev ? { ...prev, counterpartyGroups: [...prev.counterpartyGroups, created] } : prev))
    return created.id
  }

  /** 科目の登録フォームの所属グループ欄から、科目グループをその場で作る(計画Issue #290) */
  async function createAccountGroup(input: CreateAccountGroupInput): Promise<AccountGroup> {
    const created = await Promise.resolve(accountGroupRepository.create(input))
    setData((prev) => (prev ? { ...prev, accountGroups: [...prev.accountGroups, created] } : prev))
    return created
  }

  async function createProjectGroup(name: string, parentGroupId: number | null): Promise<number> {
    const created = await Promise.resolve(projectGroupRepository.create({ name, parentGroupId }))
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
  async function handleConfirm(): Promise<void> {
    confirmMetaRef.current = undefined
    return runInHistoryGroup(
      history,
      'statementImport.confirm',
      () => confirmImpl(),
      () => confirmMetaRef.current,
    )
  }

  /** 絞り込み中は表示中の行だけが対象(計画Issue #258) */
  async function confirmImpl(): Promise<void> {
    if (!session || statementOwnerId === null) return
    setBusy(true)
    setError('')
    setDoneMessage('')
    setRowErrors({})
    setConfirmResult(null)
    const account = session.targetAccount
    const deleted = new Set<number>()
    const failed: Record<number, RowErrorKind> = {}
    let unfilled = 0
    const succeeded = new Set<number>()
    // 同じ取込の行は同じ取込日時にそろえる(残高の基準点の並び順を取込単位で判定するため、計画Issue #205)
    const importedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')

    for (const index of confirmTargets) {
      const { record, externalId } = records[index]
      const state = session.rows[index]
      // 相手科目が未入力の行は、まだ入力していないだけなのでエラーにせず、確定の対象から外して表に残す(計画Issue #263)
      if (state.counterAccountId === null) {
        unfilled++
        continue
      }
      // 「置き換える」を選んだのに、削除する登録済みの仕訳が決まっていない行は、何も削除せず取り込まない
      const replacementTargetId = replacementTargetOf(records[index], state)
      if (state.approximateDecision === 'confirmed_replacement' && replacementTargetId === null) {
        failed[index] = 'replacement'
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
              financialInstitutionName: session.definition.formatGroupId,
              entryHouseholdMemberId,
              // 明細行の世帯メンバー: 科目の既定メンバー > 相手科目の行に選んだ世帯メンバー > 起票者(計画Issue #169)
              resolveLineHouseholdMemberId: createLineHouseholdMemberResolver([account, ...accountList], entryHouseholdMemberId),
            }),
          ),
        )
        succeeded.add(index)
      } catch {
        failed[index] = 'confirm'
      }
    }
    const failedCount = Object.keys(failed).length

    if (succeeded.size > 0) {
      // 操作履歴の取込の操作に、金融機関・取込先・ファイルごとの確定件数を添える(計画Issue #295)
      const countByFile = new Map<string, number>()
      for (const index of succeeded) {
        const name = records[index].fileName
        countByFile.set(name, (countByFile.get(name) ?? 0) + 1)
      }
      confirmMetaRef.current = {
        kind: 'statementImport',
        institution: session.definition.formatGroupId,
        targetAccountName: account.name,
        files: [...countByFile.entries()].map(([name, count]) => ({ name, count })),
      }
      // 選んで取り込んだ定義を、取込先の科目に紐づける(次回から候補の先頭に出る)
      await Promise.resolve(importMappingDefinitionRepository.linkAccount(session.definition.id, account.id))
    }
    setSelected(new Set())
    const nextDone = new Set([...session.done, ...succeeded])
    // 絞り込み中は、隠れた行が確定されずに残るので、取り込み対象のすべてを確定できたときだけ「全件確定」とする(計画Issue #258)
    const allConfirmed = failedCount === 0 && unfilled === 0 && importable.every((i) => succeeded.has(i))
    if (allConfirmed) {
      // 全件確定できたら、画面を取り込み前の状態に戻し、続けて明細を選ぶよう促す。再開していた一時保存は、CSVの生データごと削除する
      const finishedDraftId = currentDraftId
      clearImportScreen()
      if (finishedDraftId !== null) {
        try {
          await Promise.resolve(statementImportDraftRepository.delete(finishedDraftId))
        } catch {
          // 確定は成功しているので、一時保存の削除に失敗しても確定の結果は変えない(開始状態の一覧に残る)
        }
        await refreshDrafts()
      }
    } else {
      setSession({ ...session, done: nextDone })
    }
    setRowErrors(failed)
    if (allConfirmed) {
      setDoneMessage(t('confirmDone'))
    } else {
      // 一部が残るときは、確定した件数と、確定していない件数を、一覧の上の案内で伝える(計画Issue #263)
      setConfirmResult({ succeeded: succeeded.size, unfilled, failed: failedCount })
    }
    setBusy(false)
  }

  // 残高照合(docs/domain/reconciliation.md 1.5)。確定版として置き換える旧仕訳と、取り込まない行は除く。
  // 絞り込みの影響は受けない(計画Issue #258): 照合は取込全体の残高の連なりを確かめるもので、表示中の行だけでは意味を成さない。
  // 確定は絞り込み中は表示中の行だけだが、照合の結果はいつも取込の全体を示す
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

  /** CSVの選択ボタン。編集中は確認を通してからファイル選択を開く(計画Issue #193) */
  const chooseCsvButton = (className: string) => (
    <button type="button" className={className} disabled={busy} onClick={() => guarded(() => fileInputRef.current?.click())}>
      {t('chooseCsv')}
    </button>
  )

  /** 表の見出し。本物の表と、ページのスクロールで固定する複製(FloatingTableHeader)で同じものを使う(計画Issue #266) */
  const importHead = (
  <thead>
    <tr>
      {showFileColumn && sortHeader('file', t('colFile'))}
      <th style={{ width: 24 }}>
        <input
          type="checkbox"
          aria-label={t('selectAll')}
          checked={allSelected}
          onChange={() => {
            setBulkMessage('')
            // 見出しのチェックは、表示中のページの行だけを選ぶ・外す(ほかのタブ・ページの行には及ばない。計画Issue #263)
            setSelected(allSelected ? new Set() : new Set(selectableOrder))
          }}
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
  )

  /** 一括設定のバナーを出しているか(行を選んでいて、表示できる行がある) */
  const bulkBarShown = visibleIndices.length > 0 && selected.size > 0
  /** 一括編集で選べる項目(選択した行と、選んだ科目から決まる。計画Issue #300) */
  const bulkRules = session
    ? importBulkRules({ states: session.rows, records, selected, pick: bulkPick, accounts: accountList })
    : null
  /** 選べなくなった項目を「変更しない」に戻した、いまの選択 */
  const effectiveBulkPick = bulkRules ? sanitizeImportBulkPick(bulkPick, bulkRules) : bulkPick
  const bulkPickEmpty = isImportBulkPickEmpty(effectiveBulkPick)
  /** 取引先の追加ダイアログを開く行(摘要と相手科目の初期値に使う)。選択した対象行の先頭 */
  const bulkCreateRowIndex = session
    ? ([...selected].sort((x, y) => x - y).find((i) => statusOf(i) !== 'duplicate' && statusOf(i) !== 'skipped') ?? [...selected][0])
    : undefined
  const changeBulkPick = (patch: Partial<ImportBulkPick>) => setBulkPick((prev) => ({ ...prev, ...patch }))

  const noMatchTitle = csvs.length > 1 ? t('noMatchTitleMulti') : t('noMatchTitle', { fileName: csv?.fileName ?? '' })

  /** タブの行。右端に絞り込みの開閉ボタンを置く(専用の行は取らない、計画Issue #266)。絞り込む行が無いときはボタンを出さない */
  const tabRow = (
    <div ref={tabsRef} className="import-tabrow">
      <ImportTabBar label={t('tabsLabel')} tabs={tabItems} active={shownTab} onSelect={selectTab} />
      {visibleIndices.length > 0 && (
        <FilterToggleButton
          open={rowFilterOpen}
          activeCount={activeConditionCount(rowFilter)}
          onToggle={() => setRowFilterOpen((v) => !v)}
          controlsId="import-row-filter"
        />
      )}
    </div>
  )

  return (
    <div
      className={`import-screen${bulkBarShown ? ' import-screen--bulk' : ''}`}
      style={{ '--sticky-head-h': `${stickyHeight}px` } as CSSProperties}
    >
      {unsavedDialog}
      {overwriteConfirm !== null &&
        createPortal(
          // キーワードのポップアップ(z-index 30)より前に出すため、body直下に出し、背面を31にする(import-overwrite-confirm。計画Issue #291)
          <div className="import-overwrite-confirm">
            <ConfirmDialog
              title={t('overwriteConfirmTitle')}
              message={[
                overwriteConfirm.view.counterpartyId === null
                  ? t('overwriteConfirmAccount', { keyword: overwriteConfirm.item.text, count: overwriteConfirm.count, name: overwriteConfirm.name })
                  : t('overwriteConfirmCounterparty', {
                      keyword: overwriteConfirm.item.text,
                      count: overwriteConfirm.count,
                      name: overwriteConfirm.name,
                      account:
                        overwriteConfirm.item.accountId == null
                          ? ''
                          : t('overwriteConfirmWithAccount', { account: accountList.find((a) => a.id === overwriteConfirm.item.accountId)?.name ?? '' }),
                    }),
                overwriteConfirm.filled > 0 ? t('overwriteConfirmFilled', { filled: overwriteConfirm.filled }) : '',
                t('overwriteConfirmNote'),
              ].join('')}
              confirmLabel={t('overwriteConfirmButton', { count: overwriteConfirm.count })}
              onConfirm={confirmKeywordOverwrite}
              onCancel={() => setOverwriteConfirm(null)}
            />
          </div>,
          document.body,
        )}
      {draftDialog?.kind === 'overwrite' && (
        <ConfirmDialog
          title={t('draftOverwriteTitle')}
          message={t('draftOverwriteMessage', { account: draftDialog.accountName, time: formatDraftSavedAt(draftDialog.savedAt) })}
          confirmLabel={t('draftOverwriteConfirm')}
          onConfirm={() => draftDialog.resolve(true)}
          onCancel={() => draftDialog.resolve(false)}
        />
      )}
      {draftDialog?.kind === 'discard' && (
        <ConfirmDialog
          title={t('draftDiscardTitle')}
          message={t('draftDiscardMessage')}
          confirmLabel={t('draftDiscardConfirm')}
          onConfirm={() => {
            const { id } = draftDialog
            setDraftDialog(null)
            void discardDraft(id)
          }}
          onCancel={() => setDraftDialog(null)}
        />
      )}
      <div className="import-screen__head">
        <h1 className="import-screen__title">{t('screenTitle')}</h1>
        <div className="import-screen__controls">
          {csv && chooseCsvButton('import-btn')}
          {session && (
            <button type="button" className="import-btn" disabled={busy} onClick={() => void saveDraft()}>
              {t('draftSave')}
            </button>
          )}
          <button type="button" className="import-btn" onClick={() => guarded(onEditMappings)}>
            {t('editMappings')}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="import-error">{error}</p>}
      {draftMessage && (
        <p role="status" className="import-notice import-notice--info">
          {draftMessage}
        </p>
      )}
      {draftNotice && (
        <p role="status" className="import-notice import-notice--info">
          {t('draftResumed', { time: formatDraftSavedAt(draftNotice.savedAt) })}
        </p>
      )}
      {draftNotice !== null && draftNotice.dropped > 0 && (
        <p role="status" className="import-notice import-notice--warn">
          {t('draftDropped', { count: draftNotice.dropped })}
        </p>
      )}

      <input ref={fileInputRef} type="file" accept=".csv" multiple hidden aria-label={t('chooseCsv')} disabled={busy} onChange={handleFile} />
      {!csv && (
        <section aria-label={t('csvStartLabel')} className="import-start">
          {chooseCsvButton('import-btn import-btn--primary import-btn--large')}
          <p className="import-note">{t('csvStartNote')}</p>
        </section>
      )}

      {!csv && drafts.length > 0 && (
        <section aria-label={t('draftListLabel')} className="import-panel">
          <h2 className="import-panel__title">{t('draftListTitle')}</h2>
          <ul className="import-drafts">
            {drafts.map((draft) => {
              const accountName = data.accounts.find((a) => a.id === draft.targetAccountId)?.name ?? ''
              return (
                <li key={draft.id} className="import-drafts__item">
                  <span className="import-drafts__account">{accountName}</span>
                  <span className="import-drafts__files" title={draft.fileNames.join('、')}>
                    {draft.fileNames.length > 1
                      ? t('draftFilesMulti', { names: draft.fileNames.join('、'), count: draft.fileNames.length })
                      : draft.fileNames[0]}
                  </span>
                  <span className="import-nowrap">{t('draftFilled', { filled: draft.filledRows, total: draft.totalRows })}</span>
                  <span className="import-nowrap">{formatDraftSavedAt(draft.updatedAt)}</span>
                  <span className="import-drafts__actions">
                    <button
                      type="button"
                      className="import-btn import-btn--small import-btn--primary"
                      disabled={busy}
                      aria-label={t('draftResumeLabel', { account: accountName })}
                      onClick={() => void resumeDraft(draft.id)}
                    >
                      {t('draftResume')}
                    </button>
                    <button
                      type="button"
                      className="import-link import-link--danger"
                      disabled={busy}
                      aria-label={t('draftDiscardLabel', { account: accountName })}
                      onClick={() => setDraftDialog({ kind: 'discard', id: draft.id })}
                    >
                      {t('draftDiscard')}
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {csv && noMatch && staleDraft !== null && (
        <section
          role="alert"
          aria-label={t('draftStaleTitle', { files: staleDraft.files.map((f) => f.fileName).join('、') })}
          className="import-panel"
        >
          <p className="import-panel__title import-error">
            {t('draftStaleTitle', { files: staleDraft.files.map((f) => f.fileName).join('、') })}
          </p>
          <p className="import-note">{t('draftStaleBody')}</p>
          <div className="import-panel__actions">
            <button type="button" className="import-btn import-btn--primary" onClick={() => setShowMappingDialog(true)}>
              {t('createMappingFromCsv')}
            </button>
            <button type="button" className="import-btn" onClick={() => guarded(onEditMappings)}>
              {t('editMappings')}
            </button>
            <button type="button" className="import-btn" onClick={() => setDraftDialog({ kind: 'discard', id: staleDraft.id })}>
              {t('draftDiscardStale')}
            </button>
          </div>
        </section>
      )}

      {csv && noMatch && staleDraft === null && (
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
                <span className="import-field__label">{t('definitionLabel')}</span>
                <MappingDefinitionSelect
                  label={t('definitionLabel')}
                  definitions={candidateDefinitions}
                  value={String(match?.definition.id ?? '')}
                  placeholder={t('chooseDefinition')}
                  onChange={(value) => value !== '' && void chooseDefinition(Number(value))}
                />
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
              <div className={`import-field${targetAccountId === null ? ' import-attention' : ''}`}>
                <span className="import-field__label">{t('targetAccountLabel')}</span>
                <AccountSelect
                  label={t('targetAccountLabel')}
                  accounts={eligibleTargets}
                  accountGroups={data.accountGroups}
                  value={targetAccountId === null ? '' : String(targetAccountId)}
                  emptyLabel={t('chooseDefinition')}
                  pinned={{ name: t('accountGroupLinked'), filter: (a) => match.definition.accountIds.includes(a.id) }}
                  onChange={(value) => void changeTargetAccount(toId(value))}
                />
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
                    <span className="import-field__label">{t('statementOwnerLabel')}</span>
                    {/* 未選択のうちは、強調の枠(.import-attention)で目立たせる */}
                    <div className={statementOwnerId === null ? 'import-attention' : undefined}>
                      <MemberSelect
                        label={t('statementOwnerLabel')}
                        members={data.members}
                        value={statementOwnerId === null ? '' : String(statementOwnerId)}
                        emptyLabel={t('statementOwnerPlaceholder')}
                        onChange={(value) =>
                          setOwnerChoice(value === '' ? null : { accountId: targetAccount.id, memberId: Number(value) })
                        }
                      />
                    </div>
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

          {confirmResult && (
            // 確定のあとの案内。未入力の行はエラーではなく、確定していないだけなので黄色の注意として1行で伝える(計画Issue #263)
            <p role="status" className="import-remaining">
              {confirmResult.succeeded > 0
                ? confirmResult.unfilled > 0
                  ? t('confirmPartialSummary', { count: confirmResult.succeeded, unfilled: confirmResult.unfilled })
                  : t('confirmSucceededOnly', { count: confirmResult.succeeded })
                : confirmResult.unfilled > 0
                  ? t('confirmNothingReady', { unfilled: confirmResult.unfilled })
                  : null}
              {confirmResult.failed > 0 && (
                <>
                  <span>{t('confirmFailedLine', { count: confirmResult.failed })}</span>
                  {/* 別のタブにいても、確定できなかった行(「新規」タブにある)へ移れる */}
                  <button type="button" className="import-link" onClick={goToFirstErrorRow}>
                    {t('confirmFailedLink')}
                  </button>
                </>
              )}
            </p>
          )}

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

          {/* タブの行と絞り込み欄は、スクロールしても画面の上部に固定する(計画Issue #266)。高さは下の固定要素(一括設定の領域)の top に渡す */}
          <div className="import-sticky" ref={setStickyElement}>
            {tabRow}

            {rowFilterOpen && (
              <div id="import-row-filter">
                <ImportRowFilterPanel
                  input={rowFilterInput}
                  onChange={changeRowFilterInput}
                  onClear={() => changeRowFilterInput(EMPTY_FILTER_INPUT)}
                  counterAccountCategories={categories.counterAccounts}
                  counterpartyCategories={categories.counterparties}
                  projectCategories={categories.projects}
                  members={data.members}
                  batches={data.batches}
                  resultCount={shownTabIndices.length}
                />
              </div>
            )}
          </div>

          {/* バナーは選んだときだけ出て、タブの行・絞り込み欄の下に固定する。出入りで表の枠が上下にずれても、行は動かさない(KeepRowsInPlace、計画Issue #266) */}
          <KeepRowsInPlace visible={bulkBarShown} anchor={importRegion} />
          {bulkBarShown && bulkRules && (
            <div className="import-bulk-bar">
              <BulkBarFrame
                ariaLabel={t('bulkGroup')}
                role="group"
                summary={
                  <>
                    <strong className="bulk-bar__count">{t('bulkCount', { count: selected.size })}</strong>
                    {bulkMessage ? (
                      <span role="status" className="bulk-bar__message">
                        {bulkMessage}
                      </span>
                    ) : (
                      <span className="bulk-bar__hint">{t('bulkHint')}</span>
                    )}
                  </>
                }
                onClearSelection={() => {
                  setSelected(new Set())
                  setBulkMessage('')
                }}
                applyLabel={bulkPickEmpty || bulkRules.targetCount === 0 ? t('bulkApplyEmpty') : t('bulkApplyCount', { count: bulkRules.targetCount })}
                applyDisabled={bulkPickEmpty || bulkRules.targetCount === 0}
                onApply={applyBulk}
                columns={6}
              >
                {/* 対象の行が無い(重複・保存しない行だけを選んでいる)ときは、どの項目も選べず、その理由を出す。選べない項目は理由を項目の下に出す */}
                <BulkBarField label={t('bulkFieldCounterAccount')} reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : undefined}>
                  <TreeSelect
                    label={t('bulkCounterAccount')}
                    categories={categories.counterAccounts}
                    favoriteKind="account"
                    value={treeValue(effectiveBulkPick.counterAccountId)}
                    emptyLabel={t('bulkKeep')}
                    placeholder={t('bulkKeep')}
                    disabled={!bulkRules.accountAllowed}
                    onChange={(v) => changeBulkPick({ counterAccountId: v === '' ? null : Number(v) })}
                    onCreate={() =>
                      setCreateTarget({ kind: 'counterAccount', apply: (id) => changeBulkPick({ counterAccountId: id }) })
                    }
                    createLabel={t('createCounterAccount')}
                  />
                </BulkBarField>
                <BulkBarField label={t('bulkFieldProject')} reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : undefined}>
                  <TreeSelect
                    label={t('bulkProject')}
                    categories={categories.projects}
                    favoriteKind="project"
                    value={pickChangeToValue(effectiveBulkPick.project)}
                    emptyLabel={t('bulkKeep')}
                    leadingOptions={bulkClearOptions}
                    placeholder={t('bulkKeep')}
                    disabled={!bulkRules.projectAllowed}
                    onChange={(v) => changeBulkPick({ project: valueToPickChange(v) })}
                    onCreate={() =>
                      setCreateTarget({ kind: 'project', apply: (id) => changeBulkPick({ project: { kind: 'set', value: id } }) })
                    }
                    createLabel={t('createProject')}
                  />
                </BulkBarField>
                <BulkBarField
                  label={t('bulkFieldCounterparty')}
                  reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : bulkRules.counterpartyAllowed ? undefined : t('bulkWhyCounterparty')}
                >
                  <TreeSelect
                    label={t('bulkCounterparty')}
                    categories={categories.counterparties}
                    favoriteKind="counterparty"
                    value={pickChangeToValue(effectiveBulkPick.counterparty)}
                    emptyLabel={t('bulkKeep')}
                    leadingOptions={bulkClearOptions}
                    placeholder={t('bulkKeep')}
                    disabled={!bulkRules.counterpartyAllowed}
                    onChange={(v) => changeBulkPick({ counterparty: valueToPickChange(v) })}
                    onCreate={
                      bulkCreateRowIndex === undefined
                        ? undefined
                        : () =>
                            setCreateTarget({
                              kind: 'counterparty',
                              rowIndex: bulkCreateRowIndex,
                              apply: (id) => changeBulkPick({ counterparty: { kind: 'set', value: id } }),
                            })
                    }
                    createLabel={t('createCounterparty')}
                  />
                </BulkBarField>
                <BulkBarField
                  label={t('bulkFieldBatch')}
                  reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : bulkRules.batchAllowed ? undefined : t('bulkWhyBatch')}
                >
                  <BatchSelect
                    label={t('bulkBatch')}
                    batches={data.batches}
                    value={pickChangeToValue(effectiveBulkPick.batch)}
                    emptyLabel={t('bulkKeep')}
                    leadingOptions={bulkClearOptions}
                    placeholder={t('bulkKeep')}
                    disabled={!bulkRules.batchAllowed}
                    onCreateBatch={createBatch}
                    onChange={(v) => changeBulkPick({ batch: valueToPickChange(v) })}
                  />
                </BulkBarField>
                <BulkBarField
                  label={t('bulkFieldMember')}
                  reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : bulkRules.memberAllowed ? undefined : t('bulkWhyMember')}
                >
                  <MemberSelect
                    label={t('bulkMember')}
                    members={data.members}
                    value={pickChangeToValue(effectiveBulkPick.member)}
                    emptyLabel={t('bulkKeep')}
                    leadingOptions={bulkClearOptions}
                    placeholder={t('bulkKeep')}
                    disabled={!bulkRules.memberAllowed}
                    onChange={(v) => changeBulkPick({ member: valueToPickChange(v) })}
                  />
                </BulkBarField>
                <BulkBarField label={t('bulkFieldComment')} reason={bulkRules.targetCount === 0 ? t('bulkWhyNoTarget') : undefined}>
                  <input
                    className="import-control import-control--small bulk-bar__input"
                    aria-label={t('bulkCommentLabel')}
                    placeholder={t('bulkKeep')}
                    value={effectiveBulkPick.comment}
                    disabled={!bulkRules.commentAllowed}
                    onChange={(e) => changeBulkPick({ comment: e.target.value })}
                  />
                </BulkBarField>
              </BulkBarFrame>
            </div>
          )}

        </>
      )}

      {/* 表示できる行が無く、読めない行のタブだけのとき(絞り込み・一括編集は出さない) */}
      {session && visibleIndices.length === 0 && unreadableCount > 0 && tabRow}

      {session && (visibleIndices.length > 0 || unreadableCount > 0) && (
        <div className="import-tabarea">
          <div role="tabpanel" id={importTabPanelId(shownTab)} aria-labelledby={`import-tab-${shownTab}`} className="import-tabpanel">
            {shownTab === 'unreadable' ? (
              unreadablePanel
            ) : (
          <>
          {/* 見出しの複製。ページのスクロールで、本物の見出しが画面の上部より上へ出たときだけ固定して見せる(計画Issue #266) */}
          <FloatingTableHeader scroller={importRegion} table={importTable} syncColumnWidths tableClassName="import-table">
            {importHead}
          </FloatingTableHeader>
          <div className="import-table-wrap" ref={setImportRegion}>
            <table className="import-table" aria-label={t('tableLabel')} ref={setImportTable}>
              {importHead}
              <tbody>
                {rowFilterActive && pageIndices.length === 0 && (
                  <tr>
                    <td colSpan={showFileColumn ? 11 : 10} className="import-empty">
                      {t('filterNoMatch')}
                    </td>
                  </tr>
                )}
                {pageIndices.map((index) => {
                  const reviewRecord = records[index]
                  const state = session.rows[index]
                  const status = statusOf(index)
                  const desc = formatDescriptionForDisplay(reviewRecord.record.description)
                  const isDup = status === 'duplicate'
                  const isSkipped = status === 'skipped'
                  const group = rowGroup(reviewRecord)
                  const account = accountList.find((a) => a.id === state.counterAccountId)
                  const showCounterparty = account === undefined || isCounterpartyEligibleCategory(account.category)
                  const defaultMemberId = defaultMemberIdOf(state.counterAccountId, accountList)
                  const taggable = isTaggableAccountId(state.counterAccountId, accountList)
                  // キーワードのアイコン(計画Issue #259)。重複・保存しない行には出さない。開いているポップアップは、その行・その側のものだけ
                  const showKeywordIcons = !isDup && !isSkipped
                  const counterpartyPopup =
                    settings !== null && settings.index === index && settings.counterpartyId !== null && settings.counterpartyId === state.counterpartyId
                      ? settings
                      : null
                  const accountPopup =
                    settings !== null &&
                    settings.index === index &&
                    settings.counterpartyId === null &&
                    settings.accountId !== null &&
                    settings.accountId === state.counterAccountId
                      ? settings
                      : null
                  const matchedCounterpartyRules = showKeywordIcons ? matchedRulesOf(state, reviewRecord.record.description, 'counterparty') : []
                  const matchedAccountRules = showKeywordIcons ? matchedRulesOf(state, reviewRecord.record.description, 'account') : []
                  const matchedTooltip = (rules: KeywordRule[]) =>
                    rules.length === 0 ? undefined : t('keywordIconMatchedTooltip', { keywords: rules.map((r) => r.pattern).join('、') })
                  const counterpartyName = data.counterparties.find((c) => c.id === state.counterpartyId)?.name ?? ''
                  const setCounterAccount = (id: number | null) =>
                    updateRow(index, (s) => withCounterAccount(s, id, accountList))
                  const statusText =
                    status === 'new' ? t('statusNew') : status === 'duplicate' ? t('statusDuplicate') : status === 'skipped' ? t('statusSkipped') : t('statusCheck')

                  return (
                    <Fragment key={reviewRecord.externalId + index}>
                      <tr
                        id={`import-row-${index}`}
                        // Ctrl/Cmd を押したまま行の文字部分を押すと、その行のチェックの操作にする。行の中のボタン・入力欄は、それぞれの操作に任せる(計画Issue #235 D)
                        {...(!isDup && !isSkipped ? rangeSelection.selectingRowProps(index, { ignore: 'button, a' }) : {})}
                        className={
                          [
                            isDup ? 'import-row--dup' : '',
                            group === 'similar' ? 'import-row--similar' : '',
                            // 入力済み(相手科目が決まっている)の行。重複・保存しない行は色分けの対象外(計画Issue #231 フェーズ2)
                            status === 'new' ? 'import-row--done' : '',
                            isSkipped ? 'import-row--skipped' : '',
                            // 確定できなかった行は赤く縁取り、直下にエラーを出す(計画Issue #263)
                            rowErrors[index] !== undefined ? 'import-row--error' : '',
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
                              {...rangeSelection.checkboxProps(index)}
                            />
                          )}
                        </td>
                        <td className="import-nowrap">{reviewRecord.record.entryDate.replaceAll('-', '/')}</td>
                        <td className="import-desc">
                          {/* 摘要の右端に固定して、全行で縦にそろえる。押したときだけ別タブでGoogle検索(計画Issue #283) */}
                          <div className="import-desc-box">
                            <span className="import-desc-text">{desc}</span>
                            <a
                              className="import-icon-btn import-web-search"
                              href={buildWebSearchUrl(desc)}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t('webSearchLabel', { desc })}
                              title={t('webSearchTitle')}
                            >
                              <SearchIcon />
                            </a>
                          </div>
                        </td>
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
                              onClick={() => {
                                // 「取り込む」を選ぶと、行は「新規」タブへ移る。見失わないよう、移った先を開いて強調する(計画Issue #263)
                                updateRow(index, (s) => ({ ...s, includeDuplicate: true }))
                                jumpToRow(index, session.rows.map((s, i) => (i === index ? { ...s, includeDuplicate: true } : s)))
                              }}
                            >
                              {t('importAnyway')}
                            </button>
                          </td>
                        ) : (
                          <>
                            <td>
                              <div className="import-with-icon">
                                <TreeSelect
                                  label={t('colCounterAccount')}
                                  categories={categories.counterAccounts}
                                  // 摘要に複数のキーワードが重なって決まらなかった行は、一致した科目を先頭に出す(計画Issue #260)
                                  pinnedValues={
                                    state.counterAccountId === null && state.candidateAccountIds.length > 0
                                      ? state.candidateAccountIds.map(String)
                                      : undefined
                                  }
                                  pinnedLabel={t('candidatesPinnedLabel')}
                                  favoriteKind="account"
                                  value={treeValue(state.counterAccountId)}
                                  placeholder={t('chooseDefinition')}
                                  disabled={isSkipped}
                                  onChange={(v) => setCounterAccount(toId(v))}
                                  onCreate={() => setCreateTarget({ kind: 'counterAccount', apply: (id) => setCounterAccount(id) })}
                                  createLabel={t('createCounterAccount')}
                                />
                                {showKeywordIcons && (
                                  <CounterpartySettingsPopup
                                    kind="account"
                                    isOpen={accountPopup !== null}
                                    disabled={state.counterAccountId === null}
                                    highlighted={matchedAccountRules.length > 0}
                                    tooltip={matchedTooltip(matchedAccountRules)}
                                    onToggle={() => void toggleSettings(index, 'account')}
                                    onClose={() => void closeSettings()}
                                    counterpartyName={account?.name ?? ''}
                                    items={accountPopup === null || !accountPopup.loaded ? null : settingsItems(accountPopup)}
                                    rowDescription={desc}
                                    message={settingsMessage}
                                    saveError={settingsSaveError}
                                    onTextChange={changeKeywordText}
                                    onCommit={commitKeyword}
                                    onDelete={(key) => void deleteKeyword(key)}
                                    onAdd={addKeyword}
                                    onAccountChange={() => undefined}
                                    renderApply={accountPopup === null ? () => null : renderKeywordApply(accountPopup, account?.name ?? '')}
                                  />
                                )}
                              </div>
                              {state.counterAccountId === null && state.candidateAccountIds.length > 0 && (
                                <span className="import-note">{t('noteAccountCandidates', { count: state.candidateAccountIds.length })}</span>
                              )}
                            </td>
                            <td>
                              <div className="import-stack">
                                {showCounterparty && (
                                  <div className="import-with-icon">
                                  <TreeSelect
                                    label={t('counterpartyLabel')}
                                    disabled={isSkipped}
                                    categories={categories.counterparties}
                                    // 摘要に複数のキーワードが一致して決まらなかった行は、一致した取引先を先頭に出す(計画Issue #236)
                                    pinnedValues={
                                      state.counterpartyId === null && state.candidateCounterpartyIds.length > 0
                                        ? state.candidateCounterpartyIds.map(String)
                                        : undefined
                                    }
                                    pinnedLabel={t('candidatesPinnedLabel')}
                                    favoriteKind="counterparty"
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
                                        apply: (id) => updateRow(index, (s) => ({ ...s, counterpartyId: id })),
                                      })
                                    }
                                    createLabel={t('createCounterparty')}
                                  />
                                  {showKeywordIcons && (
                                    <CounterpartySettingsPopup
                                      isOpen={counterpartyPopup !== null}
                                      disabled={state.counterpartyId === null}
                                      highlighted={matchedCounterpartyRules.length > 0}
                                      tooltip={matchedTooltip(matchedCounterpartyRules)}
                                      onToggle={() => void toggleSettings(index, 'counterparty')}
                                      onClose={() => void closeSettings()}
                                      counterpartyName={counterpartyName}
                                      items={counterpartyPopup === null || !counterpartyPopup.loaded ? null : settingsItems(counterpartyPopup)}
                                      accountCategories={categories.defaultAccounts}
                                      rowDescription={desc}
                                      message={settingsMessage}
                                      saveError={settingsSaveError}
                                      onTextChange={changeKeywordText}
                                      onCommit={commitKeyword}
                                      onDelete={(key) => void deleteKeyword(key)}
                                      onAdd={addKeyword}
                                      onAccountChange={(key, id) => void changeKeywordAccount(key, id)}
                                      renderApply={counterpartyPopup === null ? () => null : renderKeywordApply(counterpartyPopup, counterpartyName)}
                                    />
                                  )}
                                  </div>
                                )}
                                {showCounterparty && state.counterpartyId === null && state.candidateCounterpartyIds.length > 0 && (
                                  <span className="import-note">{t('noteCandidates', { count: state.candidateCounterpartyIds.length })}</span>
                                )}
                                {taggable && (
                                  <BatchSelect
                                    label={t('rowBatch', { desc })}
                                    batches={data.batches}
                                    value={String(state.settlementBatchId ?? '')}
                                    emptyLabel={t('noBatch')}
                                    disabled={isSkipped}
                                    onCreateBatch={createBatch}
                                    onChange={(v) => updateRow(index, (s) => ({ ...s, settlementBatchId: toId(v) }))}
                                  />
                                )}
                              </div>
                            </td>
                            <td>
                              <TreeSelect
                                label={t('projectLabel')}
                                disabled={isSkipped}
                                categories={categories.projects}
                                favoriteKind="project"
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
                              <MemberSelect
                                label={t('rowMember', { desc })}
                                members={data.members}
                                value={String(defaultMemberId ?? state.householdMemberId ?? '')}
                                emptyLabel={t('memberNone')}
                                disabled={isSkipped || defaultMemberId !== null}
                                onChange={(v) => updateRow(index, (s) => ({ ...s, householdMemberId: toId(v) }))}
                              />
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
                        <tr
                          className={`import-sub import-sub--similar${status === 'new' ? ' import-sub--done' : ''}${
                            rowErrors[index] === 'replacement' ? ' import-sub--error' : ''
                          }`}
                        >
                          <td />
                          <td colSpan={showFileColumn ? 10 : 9}>
                            <div role="group" aria-label={t('similarGroupLabel', { desc })} className="import-similar">
                              {rowErrors[index] === 'replacement' && (
                                <div role="alert" className="import-rowerror">
                                  <RowErrorIcon />
                                  {t('replacementTargetRequiredError')}
                                </div>
                              )}
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
                      {rowErrors[index] === 'confirm' && (
                        <tr className="import-sub import-sub--error">
                          <td />
                          <td colSpan={showFileColumn ? 10 : 9}>
                            <div role="alert" className="import-rowerror">
                              <RowErrorIcon />
                              {t('confirmRowError')}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            <ImportPager
              total={shownTabIndices.length}
              page={shownPage.page}
              pageSize={IMPORT_PAGE_SIZE}
              onPage={goToPage}
            />
          </div>
          </>
            )}
          </div>
        </div>
      )}


      {(session || doneMessage) && (
        <div className="import-footer">
          {doneMessage && <span role="status" className="import-summary">{doneMessage}</span>}
          {session && visibleIndices.length > 0 && (
            <button type="button" className="import-btn" disabled={busy} onClick={() => void saveDraft()}>
              {t('draftSave')}
            </button>
          )}
          {session && importable.length > 0 && (
            <button
              type="button"
              className="import-btn import-btn--primary"
              disabled={busy || statementOwnerId === null || confirmTargets.length === 0}
              onClick={() => void handleConfirm()}
            >
              {t('confirmCount', { ready: readyCount, count: confirmTargets.length, account: session.targetAccount.name })}
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
          groups={data.counterpartyGroups}
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
          groupField={{ label: t('projectGroupLabel'), groups: data.projectGroups, onCreate: createProjectGroup }}
          onSubmit={(name, groupId) => createProject(name, groupId, createTarget.apply)}
          onCancel={() => setCreateTarget(null)}
        />
      )}
      {showMappingDialog && csv && (
        <MappingCreateDialog bytes={csv.bytes} institutionNames={institutionNames} onSave={saveMappingAndContinue} onCancel={() => setShowMappingDialog(false)} />
      )}
      {defaultAccountCreate !== null &&
        // 取引先の追加ダイアログ(body直下のポータル)の上に重ねて出す。同じくbody直下に出し、重なり順は入れ子用の数値(26)で明示する
        // (DOM順に頼らない。計画Issue #287)。登録した科目は初期値としてそのまま選ばれる
        createPortal(
        <div className="import-dialog__backdrop import-dialog__backdrop--nested">
          <div role="dialog" aria-modal="true" aria-label={t('createAccountTitle')} className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={accountRepository}
              balanceRecordRepository={accountBalanceRecordRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              initialCategory="expense"
              onCreateGroup={createAccountGroup}
              onCreated={(created) => {
                setData((prev) => (prev ? { ...prev, accounts: [...prev.accounts, created] } : prev))
                defaultAccountCreate(created.id)
                setDefaultAccountCreate(null)
              }}
              onCancel={() => setDefaultAccountCreate(null)}
            />
          </div>
        </div>,
        document.body,
      )}
      {(createTarget?.kind === 'counterAccount' || createTarget?.kind === 'targetAccount') &&
        // 取引先の追加ダイアログと同じく、body直下に出す(描画方法をそろえる。計画Issue #287)
        createPortal(
        <div className="import-dialog__backdrop">
          <div role="dialog" aria-modal="true" aria-label={t('createAccountTitle')} className="import-dialog import-dialog--wide">
            <AccountCreateForm
              accountRepository={accountRepository}
              balanceRecordRepository={accountBalanceRecordRepository}
              groups={data.accountGroups}
              householdMembers={data.members}
              // 取込先は資産、相手科目は費用が既定(計画Issue #218)
              initialCategory={createTarget.kind === 'targetAccount' ? 'asset' : 'expense'}
              onCreateGroup={createAccountGroup}
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
        </div>,
        document.body,
      )}
    </div>
  )
}