import type { Database } from 'sql.js'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { BudgetRepository } from '../../domain/budget/BudgetRepository'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { ExternalTransactionRefRepository } from '../../domain/reconciliation/ExternalTransactionRefRepository'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type {
  CreateJournalEntryDraftInput,
  JournalEntryDraft,
  UpdateJournalEntryDraftInput,
} from '../../domain/journal/JournalEntryDraft'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../db/SqlJsBudgetRepository'
import { SqlJsCounterpartyRepository } from '../db/SqlJsCounterpartyRepository'
import { SqlJsExternalTransactionRefRepository } from '../db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryDraftRepository } from '../db/SqlJsJournalEntryDraftRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'
import type { AutoSaveController } from '../storage/withAutoSave'

/**
 * JournalEntryDraftRepository.confirmはJournalEntryRepositoryインスタンスを引数に
 * 要求する(ドメイン層のインターフェース定義)が、RPC越しにはRepositoryインスタンス
 * (メソッドを持つオブジェクト)を構造化複製できない。Worker側は既にjournalEntryRepository
 * を保持しているため、exposeするAPIからはこの引数を除去しWorker内部で結線する。
 */
export interface JournalEntryDraftRpcApi {
  create(input: CreateJournalEntryDraftInput): JournalEntryDraft
  findById(id: number): JournalEntryDraft | null
  findAll(): JournalEntryDraft[]
  update(id: number, input: UpdateJournalEntryDraftInput): JournalEntryDraft
  delete(id: number): void
  confirm(id: number): JournalEntry
}

export interface RepositoryRegistry {
  account: AccountRepository
  budget: BudgetRepository
  counterparty: CounterpartyRepository
  externalTransactionRef: ExternalTransactionRefRepository
  householdMember: HouseholdMemberRepository
  importMappingDefinition: ImportMappingDefinitionRepository
  journalEntry: JournalEntryRepository
  journalEntryDraft: JournalEntryDraftRpcApi
  project: ProjectRepository
  recurringTransactionRule: RecurringTransactionRuleRepository
  /**
   * DBの永続化制御(計画Issue #58)。Worker側で生成済みのAutoSaveControllerをそのまま
   * 公開し、メインスレッド側がページ非表示時等に`flush()`をRPC越しに呼べるようにする。
   */
  autoSave: AutoSaveController
}

/**
 * Worker側で全10種のRepositoryインスタンスを生成し、1つのレジストリオブジェクトへ
 * まとめる(計画Issue #24のレジストリパターン)。新規Repositoryを追加する際は、
 * このオブジェクトへ1エントリ追加するだけでよい。呼び出し元(`db.worker.ts`)で
 * `withAutoSave`から得たAutoSaveControllerを`autoSaveController`として受け取り、
 * `autoSave`キーでそのまま公開する。
 */
export function createRepositoryRegistry(
  db: Database,
  autoSaveController: AutoSaveController,
): RepositoryRegistry {
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  const journalEntryDraftRepository = new SqlJsJournalEntryDraftRepository(db)

  return {
    account: new SqlJsAccountRepository(db),
    budget: new SqlJsBudgetRepository(db),
    counterparty: new SqlJsCounterpartyRepository(db),
    externalTransactionRef: new SqlJsExternalTransactionRefRepository(db),
    householdMember: new SqlJsHouseholdMemberRepository(db),
    importMappingDefinition: new SqlJsImportMappingDefinitionRepository(db),
    journalEntry: journalEntryRepository,
    journalEntryDraft: {
      create: (input) => journalEntryDraftRepository.create(input),
      findById: (id) => journalEntryDraftRepository.findById(id),
      findAll: () => journalEntryDraftRepository.findAll(),
      update: (id, input) => journalEntryDraftRepository.update(id, input),
      delete: (id) => journalEntryDraftRepository.delete(id),
      confirm: (id) => journalEntryDraftRepository.confirm(id, journalEntryRepository),
    },
    project: new SqlJsProjectRepository(db),
    recurringTransactionRule: new SqlJsRecurringTransactionRuleRepository(db),
    autoSave: autoSaveController,
  }
}
