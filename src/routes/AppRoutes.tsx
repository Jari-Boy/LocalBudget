import type * as Comlink from 'comlink'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import type { AccountRepository } from '../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../domain/account-group/AccountGroupRepository'
import type { BudgetRepository } from '../domain/budget/BudgetRepository'
import type { RecurringTransactionRuleRepository } from '../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { CounterpartyRepository } from '../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroupRepository } from '../domain/counterparty-group/CounterpartyGroupRepository'
import type { JournalEntryRepository } from '../domain/journal/JournalEntryRepository'
import type { JournalEntryLinkGroupRepository } from '../domain/journal-link-group/JournalEntryLinkGroupRepository'
import type { HouseholdMemberRepository } from '../domain/household-member/HouseholdMemberRepository'
import type { ProjectRepository } from '../domain/project/ProjectRepository'
import type { ProjectGroupRepository } from '../domain/project-group/ProjectGroupRepository'
import type { SettlementBatchRepository } from '../domain/settlement-batch/SettlementBatchRepository'
import type { ImportMappingDefinitionRepository } from '../domain/statement-import/ImportMappingDefinitionRepository'
import type { ExternalTransactionRefRepository } from '../domain/reconciliation/ExternalTransactionRefRepository'
import type { JournalEntryDraftRpcApi } from '../infrastructure/rpc/createRepositoryRegistry'
import type { RecurringTransactionProposalRpcApi } from '../infrastructure/rpc/createRecurringTransactionProposalApi'
import { useDbClient } from '../infrastructure/rpc/DbClientProvider'
import { AnalysisScreen } from '../components/analysis/AnalysisScreen'
import type { AnalysisRepositories } from '../components/analysis/analysisData'
import type { JournalEntryFilter } from '../domain/journal/JournalEntryFilter'
import { JournalScreen, type JournalScreenProps, type JournalScreenTab } from '../components/journal-entry/JournalScreen'
import { SplitSettleScreen, type SplitSettleTab } from '../components/settlement/SplitSettleScreen'
import type { SplitSettleRepositories } from '../components/settlement/splitSettleData'
import { StatementImportScreen } from '../components/statement-import/StatementImportScreen'
import { AppShell } from '../components/layout/AppShell'
import { AccountMasterTab } from '../components/master/AccountMasterTab'
import { CounterpartyMasterTab } from '../components/master/CounterpartyMasterTab'
import { MemberMasterTab } from '../components/master/MemberMasterTab'
import { ProjectMasterTab } from '../components/master/ProjectMasterTab'
import { MappingMasterTab } from '../components/master/MappingMasterTab'
import { RuleMasterTab } from '../components/master/RuleMasterTab'
import { SettingsScreen, type BackupApi } from '../components/settings/SettingsScreen'
import { ExternalChangeBanner } from '../components/settings/ExternalChangeBanner'
import { ReadOnlyBanner } from '../components/settings/ReadOnlyBanner'
import type { StorageApi } from '../components/settings/StorageSection'
import { browserFolderPicker } from '../infrastructure/storage/browserFolderPicker'
import { sessionNoticeStorage } from '../components/settings/importNotice'
import { downloadDatabaseBackup } from '../infrastructure/backup/downloadDatabaseBackup'

/**
 * 承認待ちの定期仕訳提案の件数(サイドナビの「仕訳」のバッジ用、計画Issue #150)。
 * 提案は永続化せず都度評価される(listPendingが毎回DBから再評価)ため、画面遷移のたびに
 * 取り直す。確認・見送りの直後に件数が古いまま残らないようにするため。取得に失敗しても
 * 画面操作は妨げず、バッジを出さない(0件扱い)。
 */
function usePendingProposalCount(
  api: { listPending(): Promise<readonly unknown[]> },
  pathname: string,
  refreshKey: number,
): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pending = await api.listPending()
        if (!cancelled) setCount(pending.length)
      } catch {
        if (!cancelled) setCount(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, pathname, refreshKey])
  return count
}

/**
 * ウィザードの起動と完了後の遷移を扱うルート定義
 * (計画Issue #118)。旧`Screen`型union + `useState`による分岐をreact-routerの
 * 宣言的なルート定義に置き換えた。ウィザードが引き継ぐ複雑な中間データ
 * (下書き・取込結果・割勘対象仕訳)は、URLパラメータ化せず`navigate()`の`state`
 * 経由で引き継ぐ(計画Issue #118の制約)。リロード等でstateが失われた場合は
 * 各ウィザードの入口相当の画面へフォールバックする(旧実装のuseStateガード
 * 条件を踏襲)。
 */
export function AppRoutes() {
  const client = useDbClient()
  const navigate = useNavigate()

  /**
   * Comlinkの型定義上、RepositoryRegistryのネストしたRepositoryプロパティは
   * Comlink.proxy()でマークされていないため、型上はPromisify<T>(Remote<T>ではない)
   * と推論される(createRepositoryRegistry.tsのautoSaveと同じ制約、docs/decisions.md参照)。
   * 実行時にはExpose対象オブジェクトのプロパティとして正しくRemoteオブジェクトになる
   * (e2e/worker-rpc.spec.tsで検証済み)ため、Comlink.Remote<T>を経由した型アサーションで
   * ウィザードコンポーネントが要求する構造的型(AccountCreator等)に合わせる。
   *
   * clientへのプロパティアクセス(client.account等)自体をuseMemoでclientにのみ依存させて
   * 安定化する。Comlinkのプロキシ実装(createProxy)はプロパティアクセスのたびに新しい
   * Proxyオブジェクトを生成するため、メモ化しないと毎レンダーで全リポジトリが別オブジェクト
   * になる。通常は問題にならないが、同じルートパターン内でURLパラメータだけが変わる遷移
   * (例: 関連仕訳ダイアログの行から別のentryIdへの遷移)では対象のRoute配下コンポーネントが
   * 再マウントされず同一Fiberのまま再レンダーされるため、React 19.2のdevログ機構
   * (logComponentRender、Chrome PerformanceパネルのComponentsトラック用)がpropsの差分を
   * 検出して文字列化しようとし、ComlinkのプロキシがSymbol.toPrimitive相当のアクセスを
   * 正しく処理できないため例外を投げる。この例外によりpassiveエフェクト(データ再読み込みの
   * useEffect)がコミットされず、画面が古い仕訳のまま固まる実機不具合があった
   * (計画Issue #138のUIレビューで発覚)。
   */
  const {
    accountRepository,
    journalEntryRepository,
    journalEntryLinkGroupRepository,
    householdMemberRepository,
    accountGroupRepository,
    projectRepository,
    settlementBatchRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectGroupRepository,
    journalEntryDraftRepository,
    importMappingDefinitionRepository,
    externalTransactionRefRepository,
    budgetRepository,
    recurringTransactionRuleRepository,
    recurringTransactionProposalApi,
    backupApi,
    storageApi,
  } = useMemo(
    () => ({
      accountRepository: client.account as unknown as Comlink.Remote<AccountRepository>,
      journalEntryRepository: client.journalEntry as unknown as Comlink.Remote<JournalEntryRepository>,
      journalEntryLinkGroupRepository:
        client.journalEntryLinkGroup as unknown as Comlink.Remote<JournalEntryLinkGroupRepository>,
      householdMemberRepository:
        client.householdMember as unknown as Comlink.Remote<HouseholdMemberRepository>,
      accountGroupRepository: client.accountGroup as unknown as Comlink.Remote<AccountGroupRepository>,
      projectRepository: client.project as unknown as Comlink.Remote<ProjectRepository>,
      settlementBatchRepository:
        client.settlementBatch as unknown as Comlink.Remote<SettlementBatchRepository>,
      counterpartyRepository: client.counterparty as unknown as Comlink.Remote<CounterpartyRepository>,
      counterpartyGroupRepository:
        client.counterpartyGroup as unknown as Comlink.Remote<CounterpartyGroupRepository>,
      projectGroupRepository: client.projectGroup as unknown as Comlink.Remote<ProjectGroupRepository>,
      journalEntryDraftRepository:
        client.journalEntryDraft as unknown as Comlink.Remote<JournalEntryDraftRpcApi>,
      importMappingDefinitionRepository:
        client.importMappingDefinition as unknown as Comlink.Remote<ImportMappingDefinitionRepository>,
      externalTransactionRefRepository:
        client.externalTransactionRef as unknown as Comlink.Remote<ExternalTransactionRefRepository>,
      budgetRepository: client.budget as unknown as Comlink.Remote<BudgetRepository>,
      recurringTransactionRuleRepository:
        client.recurringTransactionRule as unknown as Comlink.Remote<RecurringTransactionRuleRepository>,
      recurringTransactionProposalApi:
        client.recurringTransactionProposal as unknown as Comlink.Remote<RecurringTransactionProposalRpcApi>,
      backupApi: client.backup as unknown as Comlink.Remote<BackupApi>,
      storageApi: client.storage as unknown as Comlink.Remote<StorageApi>,
    }),
    [client],
  )

  const location = useLocation()
  // 仕訳画面で提案を確定・見送りしたときに、サイドナビのバッジの件数を取り直す
  const [proposalRefreshKey, setProposalRefreshKey] = useState(0)
  const pendingProposalCount = usePendingProposalCount(
    recurringTransactionProposalApi,
    location.pathname,
    proposalRefreshKey,
  )

  /** 仕訳画面の「定期仕訳」タブ(定期仕訳のルールの管理)の中身(計画Issue #180) */
  const rulesPanel = (
    <RuleMasterTab
      recurringTransactionRuleRepository={recurringTransactionRuleRepository}
      accountRepository={accountRepository}
      accountGroupRepository={accountGroupRepository}
      counterpartyRepository={counterpartyRepository}
      counterpartyGroupRepository={counterpartyGroupRepository}
      projectRepository={projectRepository}
      projectGroupRepository={projectGroupRepository}
      householdMemberRepository={householdMemberRepository}
      settlementBatchRepository={settlementBatchRepository}
      journalEntryRepository={journalEntryRepository}
    />
  )

  return (
    <>
    {/* 別のタブが書き込みの権利を持つとき、このタブの変更が保存されないことを画面の上部に知らせる(計画Issue #174) */}
    <ReadOnlyBanner storage={storageApi} reload={() => window.location.reload()} />
    {/* フォルダのファイルが別の端末で更新され、保存を止めているとき、入力が保存されないことを常駐で知らせる(計画Issue #175) */}
    <ExternalChangeBanner
      storage={storageApi}
      backup={backupApi}
      download={downloadDatabaseBackup}
      reload={() => window.location.reload()}
    />
    <Routes>
      {/* 中継(ハブ)画面とホーム画面は廃止した。旧URLは各領域の入口画面へリダイレクトする */}
      <Route path="/" element={<Navigate to="/journal/entries" replace />} />
      <Route path="/master" element={<Navigate to="/master/accounts" replace />} />
      {/* 科目の一覧・追加・グループは、マスタ画面のタブに統合した(計画Issue #154)。定期仕訳ルールは仕訳画面の「定期仕訳」タブへ(計画Issue #180) */}
      <Route path="/master/accounts/list" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/master/accounts/new" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/master/accounts/groups" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/journal/recurring/rules" element={<Navigate to="/journal/entries?tab=rules" replace />} />
      {/* 定期仕訳のルールの管理は、マスタ画面のタブから仕訳画面の「定期仕訳」タブへ移した(計画Issue #180) */}
      <Route path="/master/recurring" element={<Navigate to="/journal/entries?tab=rules" replace />} />
      <Route path="/journal" element={<Navigate to="/journal/entries" replace />} />
      {/* 手入力・下書き・承認待ちの定期仕訳は、仕訳画面のタブに統合した(計画Issue #152) */}
      <Route path="/journal/recurring" element={<Navigate to="/journal/entries?tab=proposals" replace />} />
      <Route path="/journal/recurring/proposals" element={<Navigate to="/journal/entries?tab=proposals" replace />} />
      <Route path="/journal/create/manual" element={<Navigate to="/journal/entries?tab=drafts" replace />} />
      <Route path="/journal/create/manual/*" element={<Navigate to="/journal/entries?tab=drafts" replace />} />
      {/* 割勘の対象選択・フォーム・精算・履歴は、割勘・精算画面の2タブに統合した(計画Issue #153) */}
      <Route path="/journal/splitting/new" element={<Navigate to="/journal/splitting" replace />} />
      <Route path="/journal/splitting/new/form" element={<Navigate to="/journal/splitting" replace />} />
      <Route path="/journal/splitting/settlement" element={<Navigate to="/journal/splitting?tab=settle" replace />} />
      <Route path="/journal/splitting/history" element={<Navigate to="/journal/splitting" replace />} />

      <Route element={<AppShell pendingProposalCount={pendingProposalCount} />}>
      <Route
        path="/master/accounts"
        element={
          <AccountMasterTab
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            householdMemberRepository={householdMemberRepository}
            journalEntryRepository={journalEntryRepository}
            budgetRepository={budgetRepository}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            importMappingDefinitionRepository={importMappingDefinitionRepository}
          />
        }
      />
      <Route
        path="/master/counterparties"
        element={
          <CounterpartyMasterTab
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            settlementBatchRepository={settlementBatchRepository}
          />
        }
      />
      <Route
        path="/master/household-members"
        element={
          <MemberMasterTab
            householdMemberRepository={householdMemberRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
          />
        }
      />
      <Route
        path="/master/projects"
        element={
          <ProjectMasterTab
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            journalEntryRepository={journalEntryRepository}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
          />
        }
      />
      <Route
        path="/master/mappings"
        element={
          <MappingMasterTab
            importMappingDefinitionRepository={importMappingDefinitionRepository}
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
          />
        }
      />
      <Route path="/journal/create/import/review" element={<Navigate to="/journal/create/import" replace />} />
      <Route
        path="/journal/create/import"
        element={
          <StatementImportScreen
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            importMappingDefinitionRepository={importMappingDefinitionRepository}
            externalTransactionRefRepository={externalTransactionRefRepository}
            journalEntryRepository={journalEntryRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            householdMemberRepository={householdMemberRepository}
            settlementBatchRepository={settlementBatchRepository}
            onEditMappings={() => navigate('/master/mappings')}
          />
        }
      />
      <Route
        path="/journal/entries"
        element={
          <JournalScreenRoute
            journalEntryRepository={journalEntryRepository}
            journalEntryDraftRepository={journalEntryDraftRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            householdMemberRepository={householdMemberRepository}
            settlementBatchRepository={settlementBatchRepository}
            recurringTransactionProposalApi={recurringTransactionProposalApi}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            rulesPanel={rulesPanel}
            onProposalsChanged={() => setProposalRefreshKey((key) => key + 1)}
          />
        }
      />
      <Route
        path="/journal/entries/:id"
        element={
          <JournalScreenRoute
            journalEntryRepository={journalEntryRepository}
            journalEntryDraftRepository={journalEntryDraftRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            householdMemberRepository={householdMemberRepository}
            settlementBatchRepository={settlementBatchRepository}
            recurringTransactionProposalApi={recurringTransactionProposalApi}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            rulesPanel={rulesPanel}
            onProposalsChanged={() => setProposalRefreshKey((key) => key + 1)}
          />
        }
      />
      <Route
        path="/journal/splitting"
        element={
          <SplitSettleScreenRoute
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            householdMemberRepository={householdMemberRepository}
            settlementBatchRepository={settlementBatchRepository}
          />
        }
      />

      {/* 分析画面は、財務諸表・グラフ分析・予算の3タブを画面内に持つ(計画Issue #155)。旧URLも同じ画面へ */}
      <Route path="/reports" element={<Navigate to="/reports/analysis" replace />} />
      <Route path="/reports/financial-statements" element={<Navigate to="/reports/analysis" replace />} />
      <Route
        path="/reports/analysis"
        element={
          <AnalysisScreenRoute
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            journalEntryRepository={journalEntryRepository}
            householdMemberRepository={householdMemberRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            budgetRepository={budgetRepository}
          />
        }
      />

      {/* 設定画面(計画Issue #173)。読み込みの成功後は、ページを再読み込みしてWorkerに新しいDBを読み直させる */}
      <Route
        path="/settings"
        element={
          <SettingsScreen
            backup={backupApi}
            storage={storageApi}
            folderPicker={browserFolderPicker}
            download={downloadDatabaseBackup}
            reload={() => window.location.reload()}
            noticeStorage={sessionNoticeStorage}
          />
        }
      />

      </Route>

      <Route path="*" element={<Navigate to="/journal/entries" replace />} />
    </Routes>
    </>
  )
}

type JournalScreenRouteProps = Omit<JournalScreenProps, 'onSplit' | 'initialTab' | 'initialEntryId'>

/**
 * 仕訳画面のルート(/journal/entries、/journal/entries/:id)。URLの`tab`(drafts・proposals)と
 * :idは最初に開くタブと仕訳の指定にだけ使い、画面内でのタブ・選択の切り替えではURLを変えない
 * (割勘の履歴など他の画面から特定の仕訳を開くため、計画Issue #152)。URLが変わったら作り直す。
 * 「この仕訳を割勘」は、対象の仕訳を`state`で渡して割勘の入力フォームへ移る。
 */
function JournalScreenRoute(props: JournalScreenRouteProps) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initialTab: JournalScreenTab = tabParam === 'drafts' || tabParam === 'proposals' || tabParam === 'rules' ? tabParam : 'list'
  const initialFilter = (useLocation().state as { filter?: JournalEntryFilter } | null)?.filter
  const entryId = id === undefined ? undefined : Number(id)

  if (entryId !== undefined && !Number.isFinite(entryId)) {
    return <Navigate to="/journal/entries" replace />
  }

  return (
    <JournalScreen
      key={`${initialTab}:${entryId ?? ''}:${JSON.stringify(initialFilter ?? null)}`}
      {...props}
      initialTab={initialTab}
      initialEntryId={entryId}
      initialFilter={initialFilter}
      onSplit={(entry) => navigate('/journal/splitting', { state: { entryIds: [entry.id] } })}
    />
  )
}

type SplitSettleScreenRouteProps = SplitSettleRepositories

/**
 * 割勘・精算画面のルート(/journal/splitting)。URLの`tab`(settle)は最初に開くタブにだけ使い、
 * 画面内でのタブ切り替えではURLを変えない。仕訳画面の「この仕訳を割勘」からは、対象の仕訳のidを
 * `navigate()`の`state`で受け取り、割勘タブで最初から選んだ状態にする(計画Issue #153)。
 * 画面は渡されたRepositoryが変わるとデータを読み直すため、オブジェクトは作り直さない。
 */
function SplitSettleScreenRoute(props: SplitSettleScreenRouteProps) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const initialTab: SplitSettleTab = searchParams.get('tab') === 'settle' ? 'settle' : 'split'
  const entryIds = (location.state as { entryIds?: number[] } | null)?.entryIds

  const repositories = useMemo(
    () => props,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    Object.values(props),
  )

  return (
    <SplitSettleScreen
      key={`${initialTab}:${(entryIds ?? []).join(',')}`}
      repositories={repositories}
      initialTab={initialTab}
      initialCheckedEntryIds={entryIds}
    />
  )
}

/**
 * 分析画面のルート(/reports/analysis)。科目の行・グラフの内訳の行から仕訳一覧へ移るときは、
 * 期間と選んだ条件(JournalEntryFilter)を`navigate()`の`state`で渡す(計画Issue #155)。
 * 画面は渡されたRepositoryが変わるとデータを読み直すため、オブジェクトは作り直さない。
 */
function AnalysisScreenRoute(props: AnalysisRepositories) {
  const navigate = useNavigate()
  const repositories = useMemo(
    () => props,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    Object.values(props),
  )
  return (
    <AnalysisScreen
      repositories={repositories}
      onOpenJournal={(filter) => navigate('/journal/entries', { state: { filter } })}
    />
  )
}
