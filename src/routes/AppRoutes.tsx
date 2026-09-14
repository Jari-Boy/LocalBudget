import type * as Comlink from 'comlink'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { AccountRepository } from '../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../domain/account-group/AccountGroupRepository'
import type { BudgetRepository } from '../domain/budget/BudgetRepository'
import type { RecurringTransactionRuleRepository } from '../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { CounterpartyRepository } from '../domain/counterparty/CounterpartyRepository'
import type { JournalEntryRepository } from '../domain/journal/JournalEntryRepository'
import type { JournalEntryDraft } from '../domain/journal/JournalEntryDraft'
import type { JournalEntry } from '../domain/journal/JournalEntry'
import type { HouseholdMemberRepository } from '../domain/household-member/HouseholdMemberRepository'
import type { ProjectRepository } from '../domain/project/ProjectRepository'
import type { ImportMappingDefinitionRepository } from '../domain/statement-import/ImportMappingDefinitionRepository'
import type { ExternalTransactionRefRepository } from '../domain/reconciliation/ExternalTransactionRefRepository'
import type { JournalEntryDraftRpcApi } from '../infrastructure/rpc/createRepositoryRegistry'
import type { RecurringTransactionProposalRpcApi } from '../infrastructure/rpc/createRecurringTransactionProposalApi'
import { useDbClient } from '../infrastructure/rpc/DbClientProvider'
import { AccountRegistrationFlow } from '../components/account-registration/AccountRegistrationFlow'
import { AccountGroupManagementScreen } from '../components/account-group-management/AccountGroupManagementScreen'
import { AccountListScreen } from '../components/account-list/AccountListScreen'
import { AccountManagementScreen } from '../components/account-management/AccountManagementScreen'
import { CounterpartyManagementScreen } from '../components/counterparty-management/CounterpartyManagementScreen'
import { HouseholdMemberManagementScreen } from '../components/household-member-management/HouseholdMemberManagementScreen'
import { ProjectManagementScreen } from '../components/project-management/ProjectManagementScreen'
import { FinancialStatementScreen } from '../components/financial-statement/FinancialStatementScreen'
import { MasterHubScreen } from '../components/master/MasterHubScreen'
import { RecurringTransactionHubScreen } from '../components/recurring-transaction/RecurringTransactionHubScreen'
import { RecurringTransactionRuleManagementScreen } from '../components/recurring-transaction-management/RecurringTransactionRuleManagementScreen'
import { RecurringTransactionProposalReviewScreen } from '../components/recurring-transaction-proposal/RecurringTransactionProposalReviewScreen'
import { JournalHubScreen } from '../components/journal-entry/JournalHubScreen'
import { JournalEntryDraftListScreen } from '../components/journal-entry/JournalEntryDraftListScreen'
import { JournalEntryForm } from '../components/journal-entry/JournalEntryForm'
import { JournalEntryListScreen } from '../components/journal-entry/JournalEntryListScreen'
import { JournalEntryDetailScreen } from '../components/journal-entry/JournalEntryDetailScreen'
import { ExpenseSplittingHubScreen } from '../components/expense-splitting/ExpenseSplittingHubScreen'
import { ExpenseSplittingEntryPickerScreen } from '../components/expense-splitting/ExpenseSplittingEntryPickerScreen'
import { ExpenseSplittingForm } from '../components/expense-splitting/ExpenseSplittingForm'
import { ExpenseSplittingHistoryScreen } from '../components/expense-splitting/ExpenseSplittingHistoryScreen'
import { SettlementScreen } from '../components/settlement/SettlementScreen'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from '../components/statement-import/StatementImportUploadScreen'
import { StatementImportReviewScreen } from '../components/statement-import/StatementImportReviewScreen'
import '../components/HubMenu.css'

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

function Home() {
  const { t } = useTranslation('master')
  const { t: tJournal } = useTranslation('journal')
  const { t: tFinancialStatement } = useTranslation('financialStatement')
  const navigate = useNavigate()

  return (
    <div className="hub-menu-screen">
      <h1>LocalBudget</h1>
      <button type="button" onClick={() => navigate('/master')}>
        {t('masterManagementTitle')}
      </button>
      <button type="button" onClick={() => navigate('/journal')}>
        {tJournal('journalHubTitle')}
      </button>
      <button type="button" onClick={() => navigate('/reports/financial-statements')}>
        {tFinancialStatement('viewFinancialStatementsTitle')}
      </button>
    </div>
  )
}

/**
 * トップ画面からの各ハブ・ウィザード起動と、完了後の遷移を扱うルート定義
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
   */
  const accountRepository = client.account as unknown as Comlink.Remote<AccountRepository>
  const journalEntryRepository = client.journalEntry as unknown as Comlink.Remote<JournalEntryRepository>
  const householdMemberRepository =
    client.householdMember as unknown as Comlink.Remote<HouseholdMemberRepository>
  const accountGroupRepository = client.accountGroup as unknown as Comlink.Remote<AccountGroupRepository>
  const projectRepository = client.project as unknown as Comlink.Remote<ProjectRepository>
  const counterpartyRepository = client.counterparty as unknown as Comlink.Remote<CounterpartyRepository>
  const journalEntryDraftRepository =
    client.journalEntryDraft as unknown as Comlink.Remote<JournalEntryDraftRpcApi>
  const importMappingDefinitionRepository =
    client.importMappingDefinition as unknown as Comlink.Remote<ImportMappingDefinitionRepository>
  const externalTransactionRefRepository =
    client.externalTransactionRef as unknown as Comlink.Remote<ExternalTransactionRefRepository>
  const budgetRepository = client.budget as unknown as Comlink.Remote<BudgetRepository>
  const recurringTransactionRuleRepository =
    client.recurringTransactionRule as unknown as Comlink.Remote<RecurringTransactionRuleRepository>
  const recurringTransactionProposalApi =
    client.recurringTransactionProposal as unknown as Comlink.Remote<RecurringTransactionProposalRpcApi>

  const goBackFromEntryDetail = useHistoryBackOrFallback('/journal/entries')

  return (
    <Routes>
      <Route path="/" element={<Home />} />

      <Route
        path="/master"
        element={
          <MasterHubScreen
            onManageAccounts={() => navigate('/master/accounts')}
            onManageCounterparties={() => navigate('/master/counterparties')}
            onManageHouseholdMembers={() => navigate('/master/household-members')}
            onManageProjects={() => navigate('/master/projects')}
            onBack={() => navigate('/')}
          />
        }
      />
      <Route
        path="/master/accounts"
        element={
          <AccountManagementScreen
            onAddAccount={() => navigate('/master/accounts/new')}
            onViewList={() => navigate('/master/accounts/list')}
            onManageGroups={() => navigate('/master/accounts/groups')}
            onBack={() => navigate('/master')}
          />
        }
      />
      <Route
        path="/master/accounts/new"
        element={
          <AccountRegistrationFlow
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            householdMemberRepository={householdMemberRepository}
            onComplete={() => navigate('/master/accounts')}
            onBack={() => navigate('/master/accounts')}
          />
        }
      />
      <Route
        path="/master/accounts/list"
        element={
          <AccountListScreen
            accountRepository={accountRepository}
            accountGroupRepository={accountGroupRepository}
            journalEntryRepository={journalEntryRepository}
            householdMemberRepository={householdMemberRepository}
            budgetRepository={budgetRepository}
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            onBack={() => navigate('/master/accounts')}
          />
        }
      />
      <Route
        path="/master/accounts/groups"
        element={
          <AccountGroupManagementScreen
            accountGroupRepository={accountGroupRepository}
            accountRepository={accountRepository}
            onBack={() => navigate('/master/accounts')}
          />
        }
      />
      <Route
        path="/master/counterparties"
        element={
          <CounterpartyManagementScreen
            counterpartyRepository={counterpartyRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            onBack={() => navigate('/master')}
          />
        }
      />
      <Route
        path="/master/household-members"
        element={
          <HouseholdMemberManagementScreen
            householdMemberRepository={householdMemberRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            onBack={() => navigate('/master')}
          />
        }
      />
      <Route
        path="/master/projects"
        element={
          <ProjectManagementScreen
            projectRepository={projectRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            onBack={() => navigate('/master')}
          />
        }
      />

      <Route
        path="/journal"
        element={
          <JournalHubScreen
            onManualEntry={() => navigate('/journal/create/manual')}
            onStatementImport={() => navigate('/journal/create/import')}
            onViewEntries={() => navigate('/journal/entries')}
            onSplitting={() => navigate('/journal/splitting')}
            onRecurringTransactions={() => navigate('/journal/recurring')}
            onBack={() => navigate('/')}
          />
        }
      />
      <Route
        path="/journal/recurring"
        element={
          <RecurringTransactionHubScreen
            onManageRules={() => navigate('/journal/recurring/rules')}
            onReviewProposals={() => navigate('/journal/recurring/proposals')}
            onBack={() => navigate('/journal')}
          />
        }
      />
      <Route
        path="/journal/recurring/rules"
        element={
          <RecurringTransactionRuleManagementScreen
            recurringTransactionRuleRepository={recurringTransactionRuleRepository}
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onBack={() => navigate('/journal/recurring')}
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
            onBack={() => navigate('/journal/recurring')}
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
            onBack={() => navigate('/journal')}
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
            onComplete={() => navigate('/')}
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
            onUploaded={(result) => navigate('/journal/create/import/review', { state: { result } })}
            onBack={() => navigate('/journal')}
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
          />
        }
      />
      <Route
        path="/journal/entries"
        element={
          <JournalEntryListScreen
            journalEntryRepository={journalEntryRepository}
            onSelectEntry={(entry) => navigate(`/journal/entries/${entry.id}`)}
            onBack={() => navigate('/journal')}
          />
        }
      />
      <Route
        path="/journal/entries/:id"
        element={
          <JournalEntryDetailRoute
            journalEntryRepository={journalEntryRepository}
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onBack={goBackFromEntryDetail}
            onDeleted={goBackFromEntryDetail}
          />
        }
      />
      <Route
        path="/journal/splitting"
        element={
          <ExpenseSplittingHubScreen
            onNewSplit={() => navigate('/journal/splitting/new')}
            onSettlement={() => navigate('/journal/splitting/settlement')}
            onHistory={() => navigate('/journal/splitting/history')}
            onBack={() => navigate('/journal')}
          />
        }
      />
      <Route
        path="/journal/splitting/new"
        element={
          <ExpenseSplittingEntryPickerScreen
            journalEntryRepository={journalEntryRepository}
            accountRepository={accountRepository}
            householdMemberRepository={householdMemberRepository}
            projectRepository={projectRepository}
            onSelectEntries={(entries) => navigate('/journal/splitting/new/form', { state: { entries } })}
            onBack={() => navigate('/journal/splitting')}
          />
        }
      />
      <Route
        path="/journal/splitting/new/form"
        element={
          <ExpenseSplittingFormRoute
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            journalEntryRepository={journalEntryRepository}
          />
        }
      />
      <Route
        path="/journal/splitting/settlement"
        element={
          <SettlementScreen
            projectRepository={projectRepository}
            accountRepository={accountRepository}
            journalEntryRepository={journalEntryRepository}
            onBack={() => navigate('/journal/splitting')}
          />
        }
      />
      <Route
        path="/journal/splitting/history"
        element={
          <ExpenseSplittingHistoryScreen
            journalEntryRepository={journalEntryRepository}
            accountRepository={accountRepository}
            projectRepository={projectRepository}
            householdMemberRepository={householdMemberRepository}
            counterpartyRepository={counterpartyRepository}
            onSelectEntry={(entry) => navigate(`/journal/entries/${entry.id}`)}
            onBack={() => navigate('/journal/splitting')}
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
            onBack={() => navigate('/')}
          />
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
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
      onComplete={() => navigate('/')}
      onBack={() => navigate('/journal/create/manual')}
    />
  )
}

interface JournalEntryDetailRouteProps {
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  accountRepository: Comlink.Remote<AccountRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  onBack: () => void
  onDeleted: () => void
}

/** URLの:idパラメータをentryIdとして仕訳詳細画面へ渡すルート。 */
function JournalEntryDetailRoute({
  journalEntryRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
  onDeleted,
}: JournalEntryDetailRouteProps) {
  const { id } = useParams()
  const entryId = Number(id)

  if (!Number.isFinite(entryId)) {
    return <Navigate to="/journal/entries" replace />
  }

  return (
    <JournalEntryDetailScreen
      entryId={entryId}
      journalEntryRepository={journalEntryRepository}
      accountRepository={accountRepository}
      projectRepository={projectRepository}
      householdMemberRepository={householdMemberRepository}
      counterpartyRepository={counterpartyRepository}
      onBack={onBack}
      onDeleted={onDeleted}
    />
  )
}

interface StatementImportReviewRouteProps {
  accountRepository: Comlink.Remote<AccountRepository>
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
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
      onBack={() => navigate('/journal/create/import')}
    />
  )
}

interface ExpenseSplittingFormRouteProps {
  accountRepository: Comlink.Remote<AccountRepository>
  projectRepository: Comlink.Remote<ProjectRepository>
  householdMemberRepository: Comlink.Remote<HouseholdMemberRepository>
  counterpartyRepository: Comlink.Remote<CounterpartyRepository>
  journalEntryRepository: Comlink.Remote<JournalEntryRepository>
}

/**
 * 割勘フォームルート(/journal/splitting/new/form)。対象選択画面から`navigate()`の
 * `state`経由で渡された対象仕訳配列を使う。リロード・直接URL入力等でstateが
 * 失われた場合(または空配列)は、対象選択画面(ウィザード入口相当)へフォールバックする
 * (旧実装のsplittingEntries.length > 0ガード条件を踏襲、計画Issue #118の制約)。
 */
function ExpenseSplittingFormRoute({
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
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
      projectRepository={projectRepository}
      householdMemberRepository={householdMemberRepository}
      counterpartyRepository={counterpartyRepository}
      journalEntryRepository={journalEntryRepository}
      onComplete={() => navigate('/')}
      onBack={() => navigate('/journal/splitting/new')}
    />
  )
}
