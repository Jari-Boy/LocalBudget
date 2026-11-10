/**
 * assertImportableDatabase のテスト(計画Issue #174)。バックアップの読み込み(計画Issue #26)と
 * フォルダのファイルを開く操作で共通の検証。使い捨てのDBでスキーマ検証 → マイグレーションの順に
 * 確かめ、LocalBudgetのDBでなければInvalidBackupFileErrorを投げる。
 * 外部依存: sql.js。ブラウザ用のcreateBrowserDatabaseはNode版に差し替える(importDatabaseBackup.test.tsと同じ)。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import initSqlJs from 'sql.js'
import { describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { assertImportableDatabase } from './assertImportableDatabase'
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

describe('assertImportableDatabase', () => {
  it('LocalBudgetのDBなら何も投げない', async () => {
    const db = await createTestDatabase()
    runMigrations(db)
    const data = db.export()
    db.close()
    await expect(assertImportableDatabase(data)).resolves.toBeUndefined()
  })

  it('LocalBudgetのテーブルを持たないDBはInvalidBackupFileErrorを投げる', async () => {
    const db = await createTestDatabase()
    const data = db.export()
    db.close()
    await expect(assertImportableDatabase(data)).rejects.toBeInstanceOf(InvalidBackupFileError)
  })

  it('DBとして読めないバイト列はInvalidBackupFileErrorを投げる', async () => {
    await expect(assertImportableDatabase(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(InvalidBackupFileError)
  })
})
