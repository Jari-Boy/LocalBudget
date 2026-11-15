import * as Comlink from 'comlink'
import type { Database } from 'sql.js'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { AccountBalanceRecordRepository } from '../../domain/reconciliation/AccountBalanceRecordRepository'
import type { BudgetRepository } from '../../domain/budget/BudgetRepository'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
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
import type { JournalEntryLinkGroupRepository } from '../../domain/journal-link-group/JournalEntryLinkGroupRepository'
import type { JournalTemplateRepository } from '../../domain/journal-template/JournalTemplateRepository'
import type { JournalTemplateGroupRepository } from '../../domain/journal-template-group/JournalTemplateGroupRepository'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsAccountBalanceRecordRepository } from '../db/SqlJsAccountBalanceRecordRepository'
import { SqlJsAccountGroupRepository } from '../db/SqlJsAccountGroupRepository'
import { SqlJsBudgetRepository } from '../db/SqlJsBudgetRepository'
import { SqlJsCounterpartyRepository } from '../db/SqlJsCounterpartyRepository'
import { SqlJsCounterpartyGroupRepository } from '../db/SqlJsCounterpartyGroupRepository'
import { SqlJsExternalTransactionRefRepository } from '../db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryDraftRepository } from '../db/SqlJsJournalEntryDraftRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsJournalEntryLinkGroupRepository } from '../db/SqlJsJournalEntryLinkGroupRepository'
import { SqlJsJournalTemplateRepository } from '../db/SqlJsJournalTemplateRepository'
import { SqlJsJournalTemplateGroupRepository } from '../db/SqlJsJournalTemplateGroupRepository'
import { SqlJsProjectRepository } from '../db/SqlJsProjectRepository'
import { SqlJsProjectGroupRepository } from '../db/SqlJsProjectGroupRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'
import { SqlJsSettlementBatchRepository } from '../db/SqlJsSettlementBatchRepository'
import { importDatabaseBackup } from '../backup/importDatabaseBackup'
import {
  createOperationHistory,
  DEFAULT_HISTORY_LIMIT,
  type HistoryOperation,
  type OperationHistory,
  type UndoPreview,
} from '../history/OperationHistory'
import {
  createRecurringTransactionProposalApi,
  type RecurringTransactionProposalRpcApi,
} from './createRecurringTransactionProposalApi'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { StorageRpcApi } from './createStorageApi'
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

/**
 * 操作履歴(ロールバック、計画Issue #202)のRPC API。履歴はWorkerのメモリ上にだけあり、永続化・
 * バックアップには含まれない。Repositoryの書き込みはレジストリが自動で記録するため、メインスレッドが
 * 記録のために呼ぶ必要はない。複数のRPC呼び出しからなるバッチ(CSV取込確定・割勘・精算など)だけは、
 * beginGroup〜endGroupで囲むと履歴上1件の取消単位になる。
 */
export interface HistoryRpcApi {
  /** 新しい順 */
  list(): HistoryOperation[]
  /** 履歴に保持する操作の上限 */
  limit(): number
  previewUndoTo(operationId: number): UndoPreview
  /** 選んだ操作とそれ以降を新しい順に戻す(全体で1トランザクション)。戻した操作数を返す */
  undoTo(operationId: number): number
  beginGroup(label: string): void
  endGroup(): void
}

export interface RepositoryRegistry {
  account: AccountRepository
  accountGroup: AccountGroupRepository
  /** 手で記録した残高(基準点、計画Issue #205)。追加・編集・削除で自動調整仕訳が計算し直される */
  accountBalanceRecord: AccountBalanceRecordRepository
  budget: BudgetRepository
  counterparty: CounterpartyRepository
  /** 取引先グループ(計画Issue #143)。表示専用、集計には関与しない */
  counterpartyGroup: CounterpartyGroupRepository
  externalTransactionRef: ExternalTransactionRefRepository
  householdMember: HouseholdMemberRepository
  importMappingDefinition: ImportMappingDefinitionRepository
  journalEntry: JournalEntryRepository
  journalEntryDraft: JournalEntryDraftRpcApi
  /** 関連仕訳グループ(計画Issue #138)。表示専用、残高計算・消込判定には関与しない */
  journalEntryLinkGroup: JournalEntryLinkGroupRepository
  /** 仕訳テンプレート(計画Issue #201)。起票時に新規仕訳フォームへ展開するひな形で、仕訳・集計には関与しない */
  journalTemplate: JournalTemplateRepository
  /** 仕訳テンプレートのグループ(計画Issue #201)。表示専用 */
  journalTemplateGroup: JournalTemplateGroupRepository
  project: ProjectRepository
  /** プロジェクトグループ(計画Issue #143)。表示専用、集計には関与しない */
  projectGroup: ProjectGroupRepository
  settlementBatch: SettlementBatchRepository
  recurringTransactionRule: RecurringTransactionRuleRepository
  /** 定期仕訳の提案評価・仕訳生成(計画Issue #121、docs/domain/recurring-transactions.md 1.2節)のRPC API */
  recurringTransactionProposal: RecurringTransactionProposalRpcApi
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
  /** 保存先の状態の取得と切り替え(計画Issue #174) */
  storage: StorageRpcApi
  /** 操作履歴の一覧・影響範囲の確認・取消(計画Issue #202) */
  history: HistoryRpcApi
}

/**
 * Repository(またはそれと同じ形のAPI)の全メソッド呼び出しを、操作履歴の1件として記録するProxyで包む。
 * 呼び出し中に書き込みがなければ履歴には残らない(読み取りは何も残さない)。ラベルは
 * 「レジストリのキー.メソッド名」(例: journalEntry.create)で、表示名への変換はUI側が行う。
 */
function recordedByHistory<T extends object>(history: OperationHistory, key: string, target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj) as unknown
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      return (...args: unknown[]) =>
        history.record(`${key}.${prop}`, () => (value as (...a: unknown[]) => unknown).apply(obj, args))
    },
  })
}

/**
 * Worker側で全12種のRepositoryインスタンスを生成し、1つのレジストリオブジェクトへ
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
  storage: StorageRpcApi,
): RepositoryRegistry {
  const journalEntryRepository = new SqlJsJournalEntryRepository(db)
  const journalEntryDraftRepository = new SqlJsJournalEntryDraftRepository(db)
  const history = createOperationHistory(db, { limit: DEFAULT_HISTORY_LIMIT })
  const recorded = <T extends object>(key: string, target: T): T => recordedByHistory(history, key, target)

  return {
    account: recorded('account', new SqlJsAccountRepository(db)),
    accountGroup: recorded('accountGroup', new SqlJsAccountGroupRepository(db)),
    accountBalanceRecord: recorded('accountBalanceRecord', new SqlJsAccountBalanceRecordRepository(db)),
    budget: recorded('budget', new SqlJsBudgetRepository(db)),
    counterparty: recorded('counterparty', new SqlJsCounterpartyRepository(db)),
    counterpartyGroup: recorded('counterpartyGroup', new SqlJsCounterpartyGroupRepository(db)),
    externalTransactionRef: recorded('externalTransactionRef', new SqlJsExternalTransactionRefRepository(db)),
    householdMember: recorded('householdMember', new SqlJsHouseholdMemberRepository(db)),
    importMappingDefinition: recorded('importMappingDefinition', new SqlJsImportMappingDefinitionRepository(db)),
    journalEntry: recorded('journalEntry', journalEntryRepository),
    journalEntryDraft: recorded('journalEntryDraft', {
      create: (input) => journalEntryDraftRepository.create(input),
      findById: (id) => journalEntryDraftRepository.findById(id),
      findAll: () => journalEntryDraftRepository.findAll(),
      update: (id, input) => journalEntryDraftRepository.update(id, input),
      delete: (id) => journalEntryDraftRepository.delete(id),
      confirm: (id) => journalEntryDraftRepository.confirm(id, journalEntryRepository),
    }),
    journalEntryLinkGroup: recorded('journalEntryLinkGroup', new SqlJsJournalEntryLinkGroupRepository(db)),
    journalTemplate: recorded('journalTemplate', new SqlJsJournalTemplateRepository(db)),
    journalTemplateGroup: recorded('journalTemplateGroup', new SqlJsJournalTemplateGroupRepository(db)),
    project: recorded('project', new SqlJsProjectRepository(db)),
    projectGroup: recorded('projectGroup', new SqlJsProjectGroupRepository(db)),
    settlementBatch: recorded('settlementBatch', new SqlJsSettlementBatchRepository(db)),
    recurringTransactionRule: recorded('recurringTransactionRule', new SqlJsRecurringTransactionRuleRepository(db)),
    recurringTransactionProposal: recorded(
      'recurringTransactionProposal',
      createRecurringTransactionProposalApi(db, journalEntryRepository),
    ),
    autoSave: Comlink.proxy(autoSaveController),
    backup: {
      export: () => db.export(),
      importDatabase: (data) => importDatabaseBackup(data, storageAdapter, autoSaveController),
    },
    storage,
    history: {
      list: () => history.list(),
      limit: () => DEFAULT_HISTORY_LIMIT,
      previewUndoTo: (operationId) => history.previewUndoTo(operationId),
      undoTo: (operationId) => history.undoTo(operationId),
      beginGroup: (label) => history.beginGroup(label),
      endGroup: () => history.endGroup(),
    },
  }
}
