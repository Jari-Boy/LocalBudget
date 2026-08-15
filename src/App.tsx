import { useState } from 'react'
import type * as Comlink from 'comlink'
import { useTranslation } from 'react-i18next'
import type { AccountRepository } from './domain/account/AccountRepository'
import type { BudgetRepository } from './domain/budget/BudgetRepository'
import type { RecurringTransactionRuleRepository } from './domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { CounterpartyRepository } from './domain/counterparty/CounterpartyRepository'
import type { JournalEntryRepository } from './domain/journal/JournalEntryRepository'
import type { JournalEntryDraft } from './domain/journal/JournalEntryDraft'
import type { HouseholdMemberRepository } from './domain/household-member/HouseholdMemberRepository'
import type { ProjectRepository } from './domain/project/ProjectRepository'
import type { ImportMappingDefinitionRepository } from './domain/statement-import/ImportMappingDefinitionRepository'
import type { ExternalTransactionRefRepository } from './domain/reconciliation/ExternalTransactionRefRepository'
import type { JournalEntryDraftRpcApi } from './infrastructure/rpc/createRepositoryRegistry'
import { DbClientProvider, useDbClient } from './infrastructure/rpc/DbClientProvider'
import { AccountRegistrationFlow } from './components/account-registration/AccountRegistrationFlow'
import { AccountListScreen } from './components/account-list/AccountListScreen'
import { AccountManagementScreen } from './components/account-management/AccountManagementScreen'
import { CounterpartyManagementScreen } from './components/counterparty-management/CounterpartyManagementScreen'
import { HouseholdMemberManagementScreen } from './components/household-member-management/HouseholdMemberManagementScreen'
import { ProjectManagementScreen } from './components/project-management/ProjectManagementScreen'
import { FinancialStatementScreen } from './components/financial-statement/FinancialStatementScreen'
import { JournalEntryDraftListScreen } from './components/journal-entry/JournalEntryDraftListScreen'
import { JournalEntryForm } from './components/journal-entry/JournalEntryForm'
import { JournalEntryListScreen } from './components/journal-entry/JournalEntryListScreen'
import { JournalEntryDetailScreen } from './components/journal-entry/JournalEntryDetailScreen'
import { ExpenseSplittingEntryPickerScreen } from './components/expense-splitting/ExpenseSplittingEntryPickerScreen'
import { ExpenseSplittingForm } from './components/expense-splitting/ExpenseSplittingForm'
import { SettlementScreen } from './components/settlement/SettlementScreen'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from './components/statement-import/StatementImportUploadScreen'
import { StatementImportReviewScreen } from './components/statement-import/StatementImportReviewScreen'
import { UpdateBanner } from './components/UpdateBanner'
import { IosInstallPrompt } from './components/IosInstallPrompt'
import type { JournalEntry } from './domain/journal/JournalEntry'
import './App.css'

type Screen =
  | 'home'
  | 'account-management'
  | 'register-account'
  | 'account-list'
  | 'counterparty-management'
  | 'household-member-management'
  | 'project-management'
  | 'financial-statement'
  | 'journal-entry-draft-list'
  | 'journal-entry-form'
  | 'journal-entry-list'
  | 'journal-entry-detail'
  | 'expense-splitting-entry-picker'
  | 'expense-splitting-form'
  | 'settlement'
  | 'statement-import-upload'
  | 'statement-import-review'

/**
 * トップ画面からのウィザード起動と、完了後のトップ画面への復帰のみを扱う
 * 最小限のアプリシェル。画面数がまだ少ないため、ルーティングライブラリは
 * 導入せずuseStateによる画面切り替えのみで完結させる(計画Issue #31、
 * 画面数が増えてから本格的なナビゲーション構造を検討する)。
 */
function AppContent() {
  const { t } = useTranslation('account')
  const { t: tJournal } = useTranslation('journal')
  const { t: tStatementImport } = useTranslation('statementImport')
  const { t: tCounterparty } = useTranslation('counterparty')
  const { t: tHouseholdMember } = useTranslation('householdMember')
  const { t: tProject } = useTranslation('project')
  const { t: tFinancialStatement } = useTranslation('financialStatement')
  const { t: tExpenseSplitting } = useTranslation('expenseSplitting')
  const client = useDbClient()
  const [screen, setScreen] = useState<Screen>('home')
  /** 下書き一覧から再開する下書き。新規作成時・未選択時はnull(計画Issue #32)。 */
  const [activeDraft, setActiveDraft] = useState<JournalEntryDraft | null>(null)
  /**
   * CSV取込アップロード完了時の結果(計画Issue #76)。RPC越しに返される値は構造化複製された
   * プレーンオブジェクト(targetAccount/definition/review)であり、ComlinkのRemoteオブジェクト
   * (Repositoryインスタンス等)は含まないため、useStateへそのまま保持してよい
   * (docs/architecture.md 6章「実装状況」のuseState更新関数誤認識の罠は、Remoteオブジェクト
   * 自体を保持する場合に限られる)。
   */
  const [uploadResult, setUploadResult] = useState<StatementImportUploadResult | null>(null)
  /** 仕訳一覧から選択した、詳細画面の対象仕訳(計画Issue #40) */
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null)
  /** 割勘対象選択画面でチェックボックス選択した、割勘起票フォームの対象仕訳(複数、計画Issue #40) */
  const [splittingEntries, setSplittingEntries] = useState<JournalEntry[]>([])

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

  if (screen === 'account-management') {
    return (
      <AccountManagementScreen
        onAddAccount={() => setScreen('register-account')}
        onViewList={() => setScreen('account-list')}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'register-account') {
    return (
      <AccountRegistrationFlow
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={() => setScreen('account-management')}
        onBack={() => setScreen('account-management')}
      />
    )
  }

  if (screen === 'account-list') {
    return (
      <AccountListScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        budgetRepository={budgetRepository}
        recurringTransactionRuleRepository={recurringTransactionRuleRepository}
        onBack={() => setScreen('account-management')}
      />
    )
  }

  if (screen === 'counterparty-management') {
    return (
      <CounterpartyManagementScreen
        counterpartyRepository={counterpartyRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'household-member-management') {
    return (
      <HouseholdMemberManagementScreen
        householdMemberRepository={householdMemberRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'project-management') {
    return (
      <ProjectManagementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'financial-statement') {
    return (
      <FinancialStatementScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'journal-entry-draft-list') {
    return (
      <JournalEntryDraftListScreen
        journalEntryDraftRepository={journalEntryDraftRepository}
        onResume={(draft) => {
          setActiveDraft(draft)
          setScreen('journal-entry-form')
        }}
        onNew={() => {
          setActiveDraft(null)
          setScreen('journal-entry-form')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'journal-entry-form') {
    return (
      <JournalEntryForm
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        journalEntryRepository={journalEntryRepository}
        journalEntryDraftRepository={journalEntryDraftRepository}
        initialDraft={activeDraft}
        onComplete={() => {
          setActiveDraft(null)
          setScreen('home')
        }}
        onBack={() => setScreen('journal-entry-draft-list')}
      />
    )
  }

  if (screen === 'journal-entry-list') {
    return (
      <JournalEntryListScreen
        journalEntryRepository={journalEntryRepository}
        onSelectEntry={(entry) => {
          setSelectedEntry(entry)
          setScreen('journal-entry-detail')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'journal-entry-detail' && selectedEntry !== null) {
    return (
      <JournalEntryDetailScreen
        entryId={selectedEntry.id}
        journalEntryRepository={journalEntryRepository}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        onBack={() => {
          setSelectedEntry(null)
          setScreen('journal-entry-list')
        }}
        onDeleted={() => {
          setSelectedEntry(null)
          setScreen('journal-entry-list')
        }}
      />
    )
  }

  if (screen === 'expense-splitting-entry-picker') {
    return (
      <ExpenseSplittingEntryPickerScreen
        journalEntryRepository={journalEntryRepository}
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        projectRepository={projectRepository}
        onSelectEntries={(entries) => {
          setSplittingEntries(entries)
          setScreen('expense-splitting-form')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'expense-splitting-form' && splittingEntries.length > 0) {
    return (
      <ExpenseSplittingForm
        originalEntries={splittingEntries}
        accountRepository={accountRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        counterpartyRepository={counterpartyRepository}
        journalEntryRepository={journalEntryRepository}
        onComplete={() => {
          setSplittingEntries([])
          setScreen('home')
        }}
        onBack={() => {
          setSplittingEntries([])
          setScreen('expense-splitting-entry-picker')
        }}
      />
    )
  }

  if (screen === 'settlement') {
    return (
      <SettlementScreen
        projectRepository={projectRepository}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'statement-import-upload') {
    return (
      <StatementImportUploadScreen
        accountRepository={accountRepository}
        importMappingDefinitionRepository={importMappingDefinitionRepository}
        externalTransactionRefRepository={externalTransactionRefRepository}
        onUploaded={(result) => {
          setUploadResult(result)
          setScreen('statement-import-review')
        }}
        onBack={() => setScreen('home')}
      />
    )
  }

  if (screen === 'statement-import-review' && uploadResult !== null) {
    return (
      <StatementImportReviewScreen
        targetAccount={uploadResult.targetAccount}
        review={uploadResult.review}
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        counterpartyRepository={counterpartyRepository}
        projectRepository={projectRepository}
        householdMemberRepository={householdMemberRepository}
        onBack={() => {
          setUploadResult(null)
          setScreen('statement-import-upload')
        }}
      />
    )
  }

  return (
    <div className="app-home">
      <h1>LocalBudget</h1>
      <button type="button" onClick={() => setScreen('account-management')}>
        {t('accountManagementTitle')}
      </button>
      <button type="button" onClick={() => setScreen('counterparty-management')}>
        {tCounterparty('viewCounterpartiesTitle')}
      </button>
      <button type="button" onClick={() => setScreen('household-member-management')}>
        {tHouseholdMember('viewHouseholdMembersTitle')}
      </button>
      <button type="button" onClick={() => setScreen('project-management')}>
        {tProject('viewProjectsTitle')}
      </button>
      <button type="button" onClick={() => setScreen('financial-statement')}>
        {tFinancialStatement('viewFinancialStatementsTitle')}
      </button>
      <button type="button" onClick={() => setScreen('journal-entry-draft-list')}>
        {tJournal('journalEntryMenuTitle')}
      </button>
      <button type="button" onClick={() => setScreen('journal-entry-list')}>
        {tJournal('entryListTitle')}
      </button>
      <button type="button" onClick={() => setScreen('expense-splitting-entry-picker')}>
        {tExpenseSplitting('entryPickerMenuTitle')}
      </button>
      <button type="button" onClick={() => setScreen('settlement')}>
        {tExpenseSplitting('settlementScreenTitle')}
      </button>
      <button type="button" onClick={() => setScreen('statement-import-upload')}>
        {tStatementImport('statementImportMenuTitle')}
      </button>
    </div>
  )
}

function App() {
  return (
    <>
      <DbClientProvider>
        <AppContent />
      </DbClientProvider>
      <UpdateBanner />
      <IosInstallPrompt />
    </>
  )
}

export default App
