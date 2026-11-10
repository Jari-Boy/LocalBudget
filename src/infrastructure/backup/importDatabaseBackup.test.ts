/**
 * importDatabaseBackup のテスト(計画Issue #26・#173)。アップロードされたバイト列を検証し、有効なときだけ
 * 自動保存の保留分を保存(flush) → 自動保存を停止(stop) → バイト列を保存(save)の順に処理すること、
 * 無効なときはどれも呼ばず既存データに触れないこと、保存の失敗が呼び出し元へ伝わることを検証する。
 * stop()は、読み込み後のページ再読み込みでpagehideから呼ばれるflush()が、Worker内に残る古いDBで
 * 読み込んだ内容を上書きしないための備えであり、Chromiumの実機(E2E)では上書きが再現しないため、
 * 呼び出しの有無と順序はここで検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。ブラウザ用のcreateBrowserDatabase(fetchでWASMを読む)は
 * Nodeで動かないため、同じsql.jsをNodeで初期化する版にvi.mockで差し替える。スキーマの検証と
 * マイグレーションは本物を使う。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import type { StorageAdapter } from '../storage/StorageAdapter'
import { withAutoSave, type AutoSaveController } from '../storage/withAutoSave'
import { importDatabaseBackup } from './importDatabaseBackup'
import { InvalidBackupFileError } from './InvalidBackupFileError'

vi.mock('../db/createBrowserDatabase', () => ({
  async createBrowserDatabase(initialData?: Uint8Array) {
    const require = createRequire(import.meta.url)
    const wasmFile = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
    const wasmBinary = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength) as ArrayBuffer
    const SQL = await initSqlJs({ wasmBinary })
    return new SQL.Database(initialData)
  },
}))

/** マイグレーション済みの(LocalBudgetの)DBのバイト列。 */
async function validBackup(): Promise<Uint8Array> {
  const db = await createTestDatabase()
  runMigrations(db)
  const data = db.export()
  db.close()
  return data
}

/** flush・stop・saveの呼び出しを1本の記録に並べる偽物。 */
function createRecorder(options: { saveError?: Error } = {}) {
  const calls: string[] = []
  const savedData: Uint8Array[] = []
  const autoSaveController: AutoSaveController = {
    flush: async () => {
      calls.push('flush')
    },
    stop: async () => {
      calls.push('stop')
    },
    getLastSaveError: () => null,
  }
  const storageAdapter: StorageAdapter = {
    load: async () => null,
    save: async (data) => {
      calls.push('save')
      if (options.saveError) throw options.saveError
      savedData.push(data)
    },
  }
  return { calls, savedData, autoSaveController, storageAdapter }
}

describe('importDatabaseBackup', () => {
  it('有効なバックアップなら、flush → stop → save の順に呼び、受け取ったバイト列を保存する', async () => {
    const data = await validBackup()
    const { calls, savedData, autoSaveController, storageAdapter } = createRecorder()

    await importDatabaseBackup(data, storageAdapter, autoSaveController)

    expect(calls).toEqual(['flush', 'stop', 'save'])
    expect(savedData).toEqual([data])
  })

  it('sqliteとして読めないファイルならInvalidBackupFileErrorを投げ、flush・stop・saveのどれも呼ばない', async () => {
    const garbage = new TextEncoder().encode('this is not a sqlite database file')
    const { calls, autoSaveController, storageAdapter } = createRecorder()

    await expect(importDatabaseBackup(garbage, storageAdapter, autoSaveController)).rejects.toBeInstanceOf(
      InvalidBackupFileError,
    )
    expect(calls).toEqual([])
  })

  it('LocalBudgetのテーブルを持たない(マイグレーション未適用の)DBならInvalidBackupFileErrorを投げ、どれも呼ばない', async () => {
    const emptyDb = await createTestDatabase()
    const data = emptyDb.export()
    emptyDb.close()
    const { calls, autoSaveController, storageAdapter } = createRecorder()

    await expect(importDatabaseBackup(data, storageAdapter, autoSaveController)).rejects.toBeInstanceOf(
      InvalidBackupFileError,
    )
    expect(calls).toEqual([])
  })

  it('バイト列の保存に失敗したら、その例外をそのまま呼び出し元へ伝える', async () => {
    const data = await validBackup()
    const saveError = new Error('IndexedDB quota exceeded')
    const { autoSaveController, storageAdapter } = createRecorder({ saveError })

    await expect(importDatabaseBackup(data, storageAdapter, autoSaveController)).rejects.toBe(saveError)
  })

  it('事前のflush()での保存が失敗しても読み込みを続けてバイト列を保存し、その後の変更は自動保存されない', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const data = await validBackup()
    const liveDb = await createTestDatabase()
    const saved: Uint8Array[] = []
    let saveCount = 0
    const storageAdapter: StorageAdapter = {
      load: async () => null,
      save: async (bytes) => {
        saveCount += 1
        // 1回目(flushによる、今のDBの保存)だけ失敗させる
        if (saveCount === 1) throw new Error('IndexedDB quota exceeded')
        saved.push(bytes)
      },
    }
    const autoSaveController = withAutoSave(liveDb, storageAdapter)

    await importDatabaseBackup(data, storageAdapter, autoSaveController)
    expect(autoSaveController.getLastSaveError()).toBeInstanceOf(Error)
    expect(saved).toEqual([data])

    // 読み込み後、再読み込みまでにWorker内の古いDBが変わっても、読み込んだ内容は上書きされない
    liveDb.run('CREATE TABLE t (id INTEGER)')
    await autoSaveController.flush()
    expect(saved).toEqual([data])
  })
})
