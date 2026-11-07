import type * as Comlink from 'comlink'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import type { AccountRepository } from '../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../domain/account-group/AccountGroupRepository'
import type { BudgetRepository } from '../domain/budget/BudgetRepository'
import type { RecurringTransactionRuleRepository } from '../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { CounterpartyRepository } from '../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroupRepository } from '../domain/counterparty-group/CounterpartyGroupRepository'
import type { JournalEntryRepository } from '../domain/journal/JournalEntryRepository'
import type { JournalEntryLinkGroupRepository } from '../domain/journal-link-group/JournalEntryLinkGroupRepository'
import type { JournalEntryDraft } from '../domain/journal/JournalEntryDraft'
import type { JournalEntry } from '../domain/journal/JournalEntry'
import type { HouseholdMemberRepository } from '../domain/household-member/HouseholdMemberRepository'
import type { ProjectRepository } from '../domain/project/ProjectRepository'
import type { ProjectGroupRepository } from '../domain/project-group/ProjectGroupRepository'
import type { SettlementBatchRepository } from '../domain/settlement-batch/SettlementBatchRepository'
import type { ImportMappingDefinitionRepository } from '../domain/statement-import/ImportMappingDefinitionRepository'
import type { ExternalTransactionRefRepository } from '../domain/reconciliation/ExternalTransactionRefRepository'
import type { JournalEntryDraftRpcApi } from '../infrastructure/rpc/createRepositoryRegistry'
import type { RecurringTransactionProposalRpcApi } from '../infrastructure/rpc/createRecurringTransactionProposalApi'
import { useDbClient } from '../infrastructure/rpc/DbClientProvider'
import { FinancialStatementScreen } from '../components/financial-statement/FinancialStatementScreen'
import { RecurringTransactionProposalReviewScreen } from '../components/recurring-transaction-proposal/RecurringTransactionProposalReviewScreen'
import { JournalEntryDraftListScreen } from '../components/journal-entry/JournalEntryDraftListScreen'
import { JournalEntryForm } from '../components/journal-entry/JournalEntryForm'
import { JournalEntryListScreen } from '../components/journal-entry/JournalEntryListScreen'
import { JournalEntryDetailScreen } from '../components/journal-entry/JournalEntryDetailScreen'
import { ExpenseSplittingEntryPickerScreen } from '../components/expense-splitting/ExpenseSplittingEntryPickerScreen'
import { ExpenseSplittingForm } from '../components/expense-splitting/ExpenseSplittingForm'
import { ExpenseSplittingHistoryScreen } from '../components/expense-splitting/ExpenseSplittingHistoryScreen'
import { SettlementScreen } from '../components/settlement/SettlementScreen'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from '../components/statement-import/StatementImportUploadScreen'
import { StatementImportReviewScreen } from '../components/statement-import/StatementImportReviewScreen'
import { AppShell } from '../components/layout/AppShell'
import { AccountMasterTab } from '../components/master/AccountMasterTab'
import { CounterpartyMasterTab } from '../components/master/CounterpartyMasterTab'
import { MemberMasterTab } from '../components/master/MemberMasterTab'
import { ProjectMasterTab } from '../components/master/ProjectMasterTab'
import { MappingMasterTab } from '../components/master/MappingMasterTab'
import { RuleMasterTab } from '../components/master/RuleMasterTab'

/** 仕訳詳細画面(/journal/entries/:id)への遷移元は複数(仕訳一覧・割勘履歴)あるため、
 * 個別の状態で戻り先を管理せずブラウザの履歴機構(navigate(-1))に委ねる。
 * 直接URL入力等で履歴が無い場合のみ、仕訳一覧をフォールバック先とする。
 */
function useHistoryBackOrFallback(fallbackPath: string) {
  const navigate = useNavigate()
  const location = useLocation()
  return () => {
    if (location.key !== 'default') {
      navigate(-1)
    } else {
      navigate(fallbackPath)
    }
  }
}

/**
 * 確認待ちの定期取引提案の件数(サイドナビの「仕訳」のバッジ用、計画Issue #150)。
 * 提案は永続化せず都度評価される(listPendingが毎回DBから再評価)ため、画面遷移のたびに
 * 取り直す。確認・見送りの直後に件数が古いまま残らないようにするため。取得に失敗しても
 * 画面操作は妨げず、バッジを出さない(0件扱い)。
 */
function usePendingProposalCount(
  api: { listPending(): Promise<readonly unknown[]> },
  pathname: string,
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
  }, [api, pathname])
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
    }),
    [client],
  )

  const goBackFromEntryDetail = useHistoryBackOrFallback('/journal/entries')

  const location = useLocation()
  const pendingProposalCount = usePendingProposalCount(recurringTransactionProposalApi, location.pathname)

  return (
    <Routes>
      {/* 中継(ハブ)画面とホーム画面は廃止した。旧URLは各領域の入口画面へリダイレクトする */}
      <Route path="/" element={<Navigate to="/journal/entries" replace />} />
      <Route path="/master" element={<Navigate to="/master/accounts" replace />} />
      {/* 科目の一覧・追加・グループ、定期取引ルールは、マスタ画面のタブに統合した(計画Issue #154) */}
      <Route path="/master/accounts/list" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/master/accounts/new" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/master/accounts/groups" element={<Navigate to="/master/accounts" replace />} />
      <Route path="/journal/recurring/rules" element={<Navigate to="/master/recurring" replace />} />
      <Route path="/journal" element={<Navigate to="/journal/entries" replace />} />
      <Route path="/journal/recurring" element={<Navigate to="/journal/recurring/proposals" replace />} />
      <Route path="/journal/splitting" element={<Navigate to="/journal/splitting/new" replace />} />

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
        path="/master/recurring"
        element={
          <RuleMasterTab
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            counterpartyRepository={counterpartyRepository}
            counterpartyGroupRepository={counterpartyGroupRepository}
            projectRepository={projectRepository}
            projectGroupRepository={projectGroupRepository}
            householdMemberRepository={householdMemberRepository}
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
      <Route
        path="/journal/recurring/proposals"
        element={
          <RecurringTransactionProposalReviewScreen
            recurringTransactionProposalApi={recurringTransactionProposalApi}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            householdMemberRepository={householdMemberRepository}
            onBack={() => navigate('/journal/recurring/proposals')}
          />
        }
      />
      <Route
        path="/journal/create/manual"
        element={
          <JournalEntryDraftListScreen
            journalEntryDraftRepository={journalEntryDraftRepository}
            onResume={(draft) => navigate(`/journal/create/manual/${draft.id}`, { state: { draft } })}
            onNew={() => navigate('/journal/create/manual/new')}
            onBack={() => navigate('/journal/entries')}
          />
        }
      />
      <Route
        path="/journal/create/manual/new"
        element={
          <JournalEntryForm
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            journalEntryRepository={journalEntryRepository}
            journalEntryDraftRepository={journalEntryDraftRepository}
            initialDraft={null}
            onComplete={() => navigate('/journal/entries')}
            onBack={() => navigate('/journal/create/manual')}
          />
        }
      />
      <Route
        path="/journal/create/manual/:draftId"
        element={
          <ResumeJournalEntryFormRoute
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            journalEntryRepository={journalEntryRepository}
            journalEntryDraftRepository={journalEntryDraftRepository}
          />
        }
      />
      <Route
        path="/journal/create/import"
        element={
          <StatementImportUploadScreen
            accountRepository={accountRepository}
            importMappingDefinitionRepository={importMappingDefinitionRepository}
            externalTransactionRefRepository={externalTransactionRefRepository}
            journalEntryRepository={journalEntryRepository}
            onUploaded={(result) => navigate('/journal/create/import/review', { state: { result } })}
            onBack={() => navigate('/journal/entries')}
          />
        }
      />
      <Route
        path="/journal/create/import/review"
        element={
          <StatementImportReviewRoute
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            counterpartyRepository={counterpartyRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            settlementBatchRepository={settlementBatchRepository}
          />
        }
      />
      <Route
        path="/journal/entries"
        element={
          <JournalEntryListScreen
            journalEntryRepository={journalEntryRepository}
            accountRepository={accountRepository}
            householdMemberRepository={householdMemberRepository}
            projectRepository={projectRepository}
            onSelectEntry={(entry) => navigate(`/journal/entries/${entry.id}`)}
            onBack={() => navigate('/journal/entries')}
          />
        }
      />
      <Route
        path="/journal/entries/:id"
        element={
          <JournalEntryDetailRoute
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onBack={goBackFromEntryDetail}
          />
        }
      />
      <Route
        path="/journal/splitting/new"
        element={
          <ExpenseSplittingEntryPickerScreen
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            householdMemberRepository={householdMemberRepository}
            projectRepository={projectRepository}
            onSelectEntries={(entries) => navigate('/journal/splitting/new/form', { state: { entries } })}
            onBack={() => navigate('/journal/splitting/new')}
          />
        }
      />
      <Route
        path="/journal/splitting/new/form"
        element={
          <ExpenseSplittingFormRoute
            accountRepository={accountRepository}
            settlementBatchRepository={settlementBatchRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
          />
        }
      />
      <Route
        path="/journal/splitting/settlement"
        element={
          <SettlementScreen
            settlementBatchRepository={settlementBatchRepository}
            accountRepository={accountRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            onBack={() => navigate('/journal/splitting/new')}
          />
        }
      />
      <Route
        path="/journal/splitting/history"
        element={
          <ExpenseSplittingHistoryScreen
            journalEntryRepository={journalEntryRepository}
            journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
            accountRepository={accountRepository}
            settlementBatchRepository={settlementBatchRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onSelectEntry={(entry) => navigate(`/journal/entries/${entry.id}`)}
            onBack={() => navigate('/journal/splitting/new')}
          />
        }
      />

      <Route
        path="/reports/financial-statements"
        element={
          <FinancialStatementScreen
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onBack={() => navigate('/journal/entries')}
          />
        }
      />

      </Route>

      <Route path="*" element={<Navigate to="/journal/entries" replace />} />
    </Routes>
  )
}

interface ResumeJournalEntryFormRouteProps {
  accountRepository: Comlink.Remote<AccountRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  journalEntryDraftRepository: Comlink.Remote<JournalEntryDraftRpcApi>
}

/**
 * 下書き再開ルート(/journal/create/manual/:draftId)。下書き一覧画面の
 * 「再開する」ボタンから`navigate()`の`state`経由で渡された下書きを使う。
 * リロード・直接URL入力等でstateが失われた場合は、下書き一覧(ウィザード入口相当)
 * へフォールバックする(旧実装のsplittingEntries等と同様のガード条件を踏襲、
 * 計画Issue #118の制約)。
 */
function ResumeJournalEntryFormRoute({
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  journalEntryDraftRepository,
}: ResumeJournalEntryFormRouteProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { draft?: JournalEntryDraft } | null

  if (!state?.draft) {
    return <Navigate to="/journal/create/manual" replace />
  }

  return (
    <JournalEntryForm
      accountRepository={accountRepository}
      projectRepository={projectRepository}
      householdMemberRepository={householdMemberRepository}
      counterpartyRepository={counterpartyRepository}
      journalEntryRepository={journalEntryRepository}
      journalEntryDraftRepository={journalEntryDraftRepository}
      initialDraft={state.draft}
      onComplete={() => navigate('/journal/entries')}
      onBack={() => navigate('/journal/create/manual')}
    />
  )
}

interface JournalEntryDetailRouteProps {
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  journalEntryLinkGroupRepository: Comlink.Remote<JournalEntryLinkGroupRepository>
  accountRepository: Comlink.Remote<AccountRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  onBack: () => void
}

/** URLの:idパラメータをentryIdとして仕訳詳細画面へ渡すルート。関連する仕訳の選択は同じ
 * 仕訳詳細画面(別のentryId)への遷移として扱う。 */
function JournalEntryDetailRoute({
  journalEntryRepository,
  journalEntryLinkGroupRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
}: JournalEntryDetailRouteProps) {
  const { id } = useParams()
  const navigate = useNavigate()
  const entryId = Number(id)

  if (!Number.isFinite(entryId)) {
    return <Navigate to="/journal/entries" replace />
  }

  return (
    <JournalEntryDetailScreen
      entryId={entryId}
      journalEntryRepository={journalEntryRepository}
      journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
      accountRepository={accountRepository}
      projectRepository={projectRepository}
      householdMemberRepository={householdMemberRepository}
      counterpartyRepository={counterpartyRepository}
      onSelectRelatedEntry={(entry) => navigate(`/journal/entries/${entry.id}`)}
      onBack={onBack}
    />
  )
}

interface StatementImportReviewRouteProps {
  accountRepository: Comlink.Remote<AccountRepository>
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  settlementBatchRepository: Comlink.Remote<SettlementBatchRepository>
}

/**
 * 明細取込レビュールート(/journal/create/import/review)。アップロード画面から
 * `navigate()`の`state`経由で渡された取込結果を使う。リロード・直接URL入力等で
 * stateが失われた場合は、アップロード画面(ウィザード入口相当)へフォールバックする
 * (旧実装のuploadResultガード条件を踏襲、計画Issue #118の制約)。
 */
function StatementImportReviewRoute({
  accountRepository,
  journalEntryRepository,
  counterpartyRepository,
  projectRepository,
  householdMemberRepository,
  settlementBatchRepository,
}: StatementImportReviewRouteProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { result?: StatementImportUploadResult } | null

  if (!state?.result) {
    return <Navigate to="/journal/create/import" replace />
  }

  return (
    <StatementImportReviewScreen
      targetAccount={state.result.targetAccount}
      review={state.result.review}
      accountRepository={accountRepository}
      journalEntryRepository={journalEntryRepository}
      counterpartyRepository={counterpartyRepository}
      projectRepository={projectRepository}
      householdMemberRepository={householdMemberRepository}
      settlementBatchRepository={settlementBatchRepository}
      onBack={() => navigate('/journal/create/import')}
    />
  )
}

interface ExpenseSplittingFormRouteProps {
  accountRepository: Comlink.Remote<AccountRepository>
  settlementBatchRepository: Comlink.Remote<SettlementBatchRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  journalEntryLinkGroupRepository: Comlink.Remote<JournalEntryLinkGroupRepository>
}

/**
 * 割勘フォームルート(/journal/splitting/new/form)。対象選択画面から`navigate()`の
 * `state`経由で渡された対象仕訳配列を使う。リロード・直接URL入力等でstateが
 * 失われた場合(または空配列)は、対象選択画面(ウィザード入口相当)へフォールバックする
 * (旧実装のsplittingEntries.length > 0ガード条件を踏襲、計画Issue #118の制約)。
 */
function ExpenseSplittingFormRoute({
  accountRepository,
  settlementBatchRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  journalEntryLinkGroupRepository,
}: ExpenseSplittingFormRouteProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { entries?: JournalEntry[] } | null

  if (!state?.entries || state.entries.length === 0) {
    return <Navigate to="/journal/splitting/new" replace />
  }

  return (
    <ExpenseSplittingForm
      originalEntries={state.entries}
      accountRepository={accountRepository}
      settlementBatchRepository={settlementBatchRepository}
      householdMemberRepository={householdMemberRepository}
      counterpartyRepository={counterpartyRepository}
      journalEntryRepository={journalEntryRepository}
      journalEntryLinkGroupRepository={journalEntryLinkGroupRepository}
      onComplete={() => navigate('/journal/entries')}
      onBack={() => navigate('/journal/splitting/new')}
    />
  )
}
