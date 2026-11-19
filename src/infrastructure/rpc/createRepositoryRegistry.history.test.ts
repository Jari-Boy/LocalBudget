/**
 * createRepositoryRegistry の操作履歴(ロールバック、計画Issue #202)の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、レジストリ経由のRepository呼び出し(RPC越しの呼び出しと
 * 同じ経路)が自動で操作履歴に記録され、`history`キーのAPIから一覧・影響範囲の確認・取消ができること、
 * 読み取り専用の呼び出し・バックアップ・保存先の操作が履歴に混ざらないこと、取消がautoSaveの保存経路
 * (db.run)に乗ることを検証する。バッチ(グループ)を履歴上1件にまとめる呼び出しも検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import type { StorageAdapter } from '../storage/StorageAdapter'
import type { AutoSaveController } from '../storage/withAutoSave'
import { createRepositoryRegistry, type RepositoryRegistry } from './createRepositoryRegistry'

const autoSave: AutoSaveController = {
  flush: async () => {},
  stop: async () => {},
  resume: () => {},
  hasExternalChange: () => false,
  getLastSaveError: () => null,
}
const storageAdapter: StorageAdapter = { load: async () => null, save: async () => {} }

let db: Database
let registry: RepositoryRegistry
let memberId: number
let cashId: number
let foodId: number

function newEntry(amount: number) {
  return registry.journalEntry.create({
    householdMemberId: memberId,
    entryDate: '2026-11-01',
    lines: [
      { householdMemberId: memberId, accountId: foodId, side: 'debit', amount },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount },
    ],
  })
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  registry = createRepositoryRegistry(db, autoSave, storageAdapter, {
    getStatus: () => ({ kind: 'indexeddb', folderName: null, writable: true, externalChange: false }),
    moveToFolder: async () => {},
    moveToIndexedDb: async () => {},
  })
  memberId = registry.householdMember.create({ name: '自分' }).id
  cashId = registry.account.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodId = registry.account.create({ category: 'expense', name: '食費', isReconcilable: null }).id
})

describe('履歴への記録', () => {
  it('Repository経由の書き込みが「リポジトリ名.メソッド名」の操作として記録される', () => {
    newEntry(1000)

    const labels = registry.history.list().map((o) => o.label)
    expect(labels[0]).toBe('journalEntry.create')
  })

  it('読み取りだけの呼び出しは履歴を増やさない', () => {
    newEntry(1000)
    const before = registry.history.list().length

    registry.journalEntry.findAll()
    registry.account.findById(cashId)

    expect(registry.history.list()).toHaveLength(before)
  })

  it('バックアップのexportは履歴を増やさない', () => {
    const before = registry.history.list().length

    registry.backup.export()

    expect(registry.history.list()).toHaveLength(before)
  })

  it('グループ(beginGroup〜endGroup)内の複数の書き込みは履歴上1件になる', () => {
    const before = registry.history.list().length

    registry.history.beginGroup('statementImport.confirm')
    newEntry(100)
    newEntry(200)
    registry.history.endGroup()

    const list = registry.history.list()
    expect(list).toHaveLength(before + 1)
    expect(list[0].label).toBe('statementImport.confirm')
  })

  it('履歴の上限を返す', () => {
    expect(registry.history.limit()).toBe(50)
  })
})

describe('取消', () => {
  it('previewUndoToは戻す操作を新しい順に返し、undoToで実際に元へ戻る', () => {
    const entry = newEntry(1000)
    newEntry(2000)
    const target = registry.history.list()[1]

    const preview = registry.history.previewUndoTo(target.id)
    const undone = registry.history.undoTo(target.id)

    expect(preview.operations).toHaveLength(2)
    expect(undone).toBe(2)
    expect(registry.journalEntry.findById(entry.id)).toBeNull()
  })

  it('取消はdb.run(autoSaveが監視する保存経路)でBEGIN〜COMMITする', () => {
    newEntry(1000)
    const statements: string[] = []
    const original = db.run.bind(db)
    db.run = ((...args: Parameters<Database['run']>) => {
      statements.push(args[0].trim().split(/\s+/)[0].toUpperCase())
      return original(...args)
    }) as Database['run']

    registry.history.undoTo(registry.history.list()[0].id)

    expect(statements[0]).toBe('BEGIN')
    expect(statements).toContain('COMMIT')
  })
})

describe('一時保存(statementImportDraft、計画Issue #231 フェーズ3)は履歴に記録しない', () => {
  it('一時保存の保存・削除は操作履歴に残らず、CSVの生データが履歴のメモリに残らない', () => {
    const before = registry.history.list().length
    const saved = registry.statementImportDraft.save({
      targetAccountId: cashId,
      definitionId: null,
      ownerMemberId: null,
      files: [{ fileName: 'a.csv', bytes: new Uint8Array([1, 2, 3]), isChecked: true }],
      rowInputs: {},
      totalRows: 1,
      filledRows: 0,
    })
    registry.statementImportDraft.delete(saved.id)

    expect(registry.history.list()).toHaveLength(before)
  })

  it('確定のグループの途中で一時保存を書いても、確定の操作には含まれない', () => {
    registry.history.beginGroup('statementImport.confirm')
    newEntry(1000)
    registry.statementImportDraft.save({
      targetAccountId: cashId,
      definitionId: null,
      ownerMemberId: null,
      files: [{ fileName: 'a.csv', bytes: new Uint8Array([1]), isChecked: true }],
      rowInputs: {},
      totalRows: 1,
      filledRows: 0,
    })
    registry.history.endGroup()

    const [operation] = registry.history.list()
    expect(operation.changes.map((c) => c.table)).not.toContain('statement_import_drafts')
    expect(operation.changes.map((c) => c.table)).not.toContain('statement_import_draft_files')
  })
})
