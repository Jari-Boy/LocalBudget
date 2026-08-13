import { useState } from 'react'
import type * as Comlink from 'comlink'
import { useTranslation } from 'react-i18next'
import type { AccountRepository } from './domain/account/AccountRepository'
import type { CounterpartyRepository } from './domain/counterparty/CounterpartyRepository'
import type { JournalEntryRepository } from './domain/journal/JournalEntryRepository'
import type { JournalEntryDraft } from './domain/journal/JournalEntryDraft'
import type { HouseholdMemberRepository } from './domain/household-member/HouseholdMemberRepository'
import type { ProjectRepository } from './domain/project/ProjectRepository'
import type { ImportMappingDefinitionRepository } from './domain/statement-import/ImportMappingDefinitionRepository'
import type { ExternalTransactionRefRepository } from './domain/reconciliation/ExternalTransactionRefRepository'
import type { JournalEntryDraftRpcApi } from './infrastructure/rpc/createRepositoryRegistry'
import { DbClientProvider, useDbClient } from './infrastructure/rpc/DbClientProvider'
import { AccountRegistrationWizard } from './components/account-registration/AccountRegistrationWizard'
import { CreditCardRegistrationWizard } from './components/account-registration/CreditCardRegistrationWizard'
import { AccountListScreen } from './components/account-list/AccountListScreen'
import { CounterpartyManagementScreen } from './components/counterparty-management/CounterpartyManagementScreen'
import { HouseholdMemberManagementScreen } from './components/household-member-management/HouseholdMemberManagementScreen'
import { ProjectManagementScreen } from './components/project-management/ProjectManagementScreen'
import { JournalEntryDraftListScreen } from './components/journal-entry/JournalEntryDraftListScreen'
import { JournalEntryForm } from './components/journal-entry/JournalEntryForm'
import {
  StatementImportUploadScreen,
  type StatementImportUploadResult,
} from './components/statement-import/StatementImportUploadScreen'
import { StatementImportReviewScreen } from './components/statement-import/StatementImportReviewScreen'
import { UpdateBanner } from './components/UpdateBanner'
import { IosInstallPrompt } from './components/IosInstallPrompt'
import './App.css'

type Screen =
  | 'home'
  | 'register-account'
  | 'register-credit-card'
  | 'account-list'
  | 'counterparty-management'
  | 'household-member-management'
  | 'project-management'
  | 'journal-entry-draft-list'
  | 'journal-entry-form'
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

  if (screen === 'register-account') {
    return (
      <AccountRegistrationWizard
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={() => setScreen('home')}
      />
    )
  }

  if (screen === 'register-credit-card') {
    return (
      <CreditCardRegistrationWizard
        accountRepository={accountRepository}
        householdMemberRepository={householdMemberRepository}
        onComplete={() => setScreen('home')}
      />
    )
  }

  if (screen === 'account-list') {
    return (
      <AccountListScreen
        accountRepository={accountRepository}
        journalEntryRepository={journalEntryRepository}
        householdMemberRepository={householdMemberRepository}
        onBack={() => setScreen('home')}
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
      <button type="button" onClick={() => setScreen('register-account')}>
        {t('registerAccountTitle')}
      </button>
      <button type="button" onClick={() => setScreen('register-credit-card')}>
        {t('registerCreditCardTitle')}
      </button>
      <button type="button" onClick={() => setScreen('account-list')}>
        {t('viewAccountsTitle')}
      </button>
      <button type="button" onClick={() => setScreen('counterparty-management')}>
        {tCounterparty('viewCounterpartiesTitle')}
      </button>
      <button type="button" onClick={() => setScreen('household-member-management')}>
        {tHouseholdMember('viewHouseholdMembersTitle')}
      <button type="button" onClick={() => setScreen('project-management')}>
        {tProject('viewProjectsTitle')}
      </button>
      <button type="button" onClick={() => setScreen('journal-entry-draft-list')}>
        {tJournal('journalEntryMenuTitle')}
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
