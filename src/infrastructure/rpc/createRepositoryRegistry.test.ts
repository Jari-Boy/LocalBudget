/**
 * createRepositoryRegistry の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、Worker側でexposeする10種のRepository
 * インスタンスが正しいSqlJs実装クラスで生成されることを検証する。またjournalEntryDraft
 * のconfirmはJournalEntryRepositoryインスタンスを直接引数に取れない(RPC越しに構造化複製
 * できないため)、レジストリ内部でjournalEntryRepositoryと結線されたラッパーになっており、
 * 通常のconfirmフロー(仕訳化・下書き削除)が機能することも合わせて検証する。
 * 呼び出し元(Worker側、`db.worker.ts`)から渡されたAutoSaveControllerが`autoSave`キー
 * としてそのまま公開され、メインスレッドからRPC越しに`flush()`を呼べることも検証する
 * (計画Issue #58)。backup.export()がdb.export()と同じ内容を返すことも検証する
 * (計画Issue #26)。backup.importDatabase()はブラウザ専用のcreateBrowserDatabaseに
 * 依存するためNode/Vitestでは検証できず、Playwrightで検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { SqlJsAccountRepository } from '../db/SqlJsAccountRepository'
import { SqlJsBudgetRepository } from '../db/SqlJsBudgetRepository'
import { SqlJsCounterpartyRepository } from '../db/SqlJsCounterpartyRepository'
import { SqlJsExternalTransactionRefRepository } from '../db/SqlJsExternalTransactionRefRepository'
import { SqlJsHouseholdMemberRepository } from '../db/SqlJsHouseholdMemberRepository'
import { SqlJsImportMappingDefinitionRepository } from '../db/SqlJsImportMappingDefinitionRepository'
import { SqlJsJournalEntryRepository } from '../db/SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from '../db/SqlJsProjectRepository'
import { SqlJsRecurringTransactionRuleRepository } from '../db/SqlJsRecurringTransactionRuleRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { AutoSaveController } from '../storage/withAutoSave'
import { createRepositoryRegistry, type RepositoryRegistry } from './createRepositoryRegistry'

function createStubAutoSaveController(): AutoSaveController {
  return {
    flush: async () => {},
    getLastSaveError: () => null,
  }
}

function createStubStorageAdapter(): StorageAdapter {
  return {
    load: async () => null,
    save: async () => {},
  }
}

let db: Database
let registry: RepositoryRegistry
let autoSaveController: AutoSaveController
let storageAdapter: StorageAdapter

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  autoSaveController = createStubAutoSaveController()
  storageAdapter = createStubStorageAdapter()
  registry = createRepositoryRegistry(db, autoSaveController, storageAdapter)
})

describe('createRepositoryRegistry', () => {
  it('10種全てのキーに対応するSqlJs実装クラスのインスタンスを割り当てる', () => {
    expect(registry.account).toBeInstanceOf(SqlJsAccountRepository)
    expect(registry.budget).toBeInstanceOf(SqlJsBudgetRepository)
    expect(registry.counterparty).toBeInstanceOf(SqlJsCounterpartyRepository)
    expect(registry.externalTransactionRef).toBeInstanceOf(
      SqlJsExternalTransactionRefRepository,
    )
    expect(registry.householdMember).toBeInstanceOf(SqlJsHouseholdMemberRepository)
    expect(registry.importMappingDefinition).toBeInstanceOf(
      SqlJsImportMappingDefinitionRepository,
    )
    expect(registry.journalEntry).toBeInstanceOf(SqlJsJournalEntryRepository)
    expect(registry.project).toBeInstanceOf(SqlJsProjectRepository)
    expect(registry.recurringTransactionRule).toBeInstanceOf(
      SqlJsRecurringTransactionRuleRepository,
    )
  })

  it('autoSaveキーには呼び出し元から渡されたAutoSaveControllerがそのまま割り当てられる', () => {
    expect(registry.autoSave).toBe(autoSaveController)
  })

  it('backup.export()はdb.export()と同じバイト列を返す', () => {
    registry.account.create({ category: 'asset', name: '現金', isReconcilable: false })

    expect(registry.backup.export()).toEqual(db.export())
  })

  it('同じレジストリ内のaccountとjournalEntryは同一DB接続を共有する(仕訳作成後に同じ接続のaccountから参照可能)', () => {
    const account = registry.account.create({
      category: 'asset',
      name: '現金',
      isReconcilable: false,
    })

    expect(registry.account.findById(account.id)).not.toBeNull()
  })

  describe('journalEntryDraft.confirm', () => {
    it('完成した下書きを仕訳化し、journalEntryから参照でき下書きは削除される', () => {
      const foodExpenseAccountId = registry.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      }).id
      const cashAccountId = registry.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      }).id
      const draft = registry.journalEntryDraft.create({
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
          { accountId: cashAccountId, side: 'credit', amount: 3000 },
        ],
      })

      const confirmed = registry.journalEntryDraft.confirm(draft.id)

      expect(registry.journalEntry.findById(confirmed.id)).not.toBeNull()
      expect(registry.journalEntryDraft.findById(draft.id)).toBeNull()
    })

    it('貸借不一致の下書きはUnbalancedJournalEntryErrorをスローし、下書きを残す', () => {
      const foodExpenseAccountId = registry.account.create({
        category: 'expense',
        name: '食費',
        isReconcilable: null,
      }).id
      const cashAccountId = registry.account.create({
        category: 'asset',
        name: '現金',
        isReconcilable: false,
      }).id
      const draft = registry.journalEntryDraft.create({
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
          { accountId: cashAccountId, side: 'credit', amount: 2000 },
        ],
      })

      expect(() => registry.journalEntryDraft.confirm(draft.id)).toThrow(
        UnbalancedJournalEntryError,
      )
      expect(registry.journalEntryDraft.findById(draft.id)).not.toBeNull()
    })
  })
})
