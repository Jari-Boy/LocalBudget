import * as Comlink from 'comlink'
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
import { importDatabaseBackup } from '../backup/importDatabaseBackup'
import type { StorageAdapter } from '../storage/StorageAdapter'
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

/**
 * バックアップExport/Import(計画Issue #26)のRPC API。exportは現在の生きたDBの
 * バイト列をそのまま返す(db.export()は常に最新の状態を返すため、事前のflush()等は
 * 不要)。importDatabaseは検証・保存のみを行い、ページのリロードは行わない
 * (windowはWeb Worker内に存在しないため、呼び出し元のメインスレッド側が
 * このRPC呼び出しの成功後にリロードする責務を持つ)。
 */
export interface BackupRpcApi {
  export(): Uint8Array
  importDatabase(data: Uint8Array): Promise<void>
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
   * Comlinkの型定義上、ネストしたオブジェクトのプロパティは既定で構造化複製可能な値
   * (`Promisify<T>`、TypeScript上は`Promise<AutoSaveController>`)とみなされ、メソッド
   * 呼び出しの中継対象(`Remote<T>`)としては扱われない。`Comlink.proxy()`でProxyMarkedを
   * 付与することで後者の扱いになるようにしている。journalEntryDraft.confirmが抱えていた
   * 「Repositoryインスタンスを引数として構造化複製できない」制約とは問題の所在が異なり
   * (あちらは縮小シグネチャのラッパーAPIで解消、こちらはComlink.proxy()で解消)、
   * 解決方法も別物である点に注意(docs/decisions.md参照)。
   */
  autoSave: AutoSaveController & Comlink.ProxyMarked
  backup: BackupRpcApi
}

/**
 * Worker側で全10種のRepositoryインスタンスを生成し、1つのレジストリオブジェクトへ
 * まとめる(計画Issue #24のレジストリパターン)。新規Repositoryを追加する際は、
 * このオブジェクトへ1エントリ追加するだけでよい。呼び出し元(`db.worker.ts`)で
 * `withAutoSave`から得たAutoSaveControllerを`autoSaveController`として受け取り、
 * `autoSave`キーでそのまま公開する。同じく呼び出し元から渡された`storageAdapter`は
 * `backup.importDatabase`(計画Issue #26)がインポート検証成功後の永続化に使う。
 */
export function createRepositoryRegistry(
  db: Database,
  autoSaveController: AutoSaveController,
  storageAdapter: StorageAdapter,
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
    autoSave: Comlink.proxy(autoSaveController),
    backup: {
      export: () => db.export(),
      importDatabase: (data) => importDatabaseBackup(data, storageAdapter, autoSaveController),
    },
  }
}
