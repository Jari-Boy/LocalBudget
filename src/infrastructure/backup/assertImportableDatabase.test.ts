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
import { LATEST_SCHEMA_VERSION, runMigrations } from '../db/migrations'
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

  it('古いバージョンのバックアップは、差分を流せるので読み込める(計画Issue #42)', async () => {
    const db = await createTestDatabase()
    runMigrations(db)
    // バージョン1のDB(仕訳テンプレートの表が無い)を再現する
    db.run('DROP TABLE journal_template_lines')
    db.run('DROP TABLE journal_templates')
    db.run('DROP TABLE journal_template_groups')
    db.run('PRAGMA user_version = 1')
    const data = db.export()
    db.close()
    await expect(assertImportableDatabase(data)).resolves.toBeUndefined()
  })

  it('アプリより新しいバージョンのバックアップはInvalidBackupFileErrorで拒否し、理由に新しいバージョンであることを示す(計画Issue #42)', async () => {
    const db = await createTestDatabase()
    runMigrations(db)
    db.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    const data = db.export()
    db.close()

    const error = await assertImportableDatabase(data).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(InvalidBackupFileError)
    expect((error as Error).message).toMatch(/newer version/)
  })

  it('DBとして読めないバイト列はInvalidBackupFileErrorを投げる', async () => {
    await expect(assertImportableDatabase(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(InvalidBackupFileError)
  })
})
