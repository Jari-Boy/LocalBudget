/**
 * openMigratedDatabase(Worker起動時のDB準備、計画Issue #42)のユニットテスト。
 * 保存先から読んだバイト列でDBを開き、最新のスキーマにする。既存DBの移行では、流す前に元のバイト列を
 * バックアップへ保存し、成功したら直ちに保存する。失敗(移行の失敗・新しすぎるバージョン・バックアップの失敗)は
 * StartupDatabaseErrorで、元のバイト列(書き出し用)を添えて投げる。読み取り専用のタブでは、バックアップも保存もしない。
 * 外部依存: sql.js(Node上)。保存・バックアップはメモリ上の偽物(vi.fn)。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { getUserVersion, type MigrationPlan } from './migrations'
import { openMigratedDatabase, StartupDatabaseError } from './openMigratedDatabase'

const plan: MigrationPlan = {
  latestVersion: 2,
  createLatest: (db) => db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT)'),
  diffs: { 2: ['ALTER TABLE t ADD COLUMN b TEXT'] },
}

async function createV1Bytes(version = 1): Promise<Uint8Array> {
  const db = await createTestDatabase()
  db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)')
  db.run("INSERT INTO t (a) VALUES ('keep')")
  db.run(`PRAGMA user_version = ${version}`)
  return db.export()
}

function deps(savedData: Uint8Array | null, overrides: { writable?: boolean; plan?: MigrationPlan } = {}) {
  return {
    savedData,
    createDatabase: async (data?: Uint8Array): Promise<Database> => {
      return data === undefined ? createTestDatabase() : openFromBytes(data)
    },
    save: vi.fn(async () => {}),
    saveBackup: vi.fn(async () => {}),
    writable: true,
    plan,
    ...overrides,
  }
}

async function openFromBytes(data: Uint8Array): Promise<Database> {
  const { createRequire } = await import('node:module')
  const { readFileSync } = await import('node:fs')
  const initSqlJs = (await import('sql.js')).default
  const wasm = readFileSync(createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'))
  const SQL = await initSqlJs({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
  const db = new SQL.Database(data)
  db.run('PRAGMA foreign_keys = ON')
  return db
}

describe('openMigratedDatabase', () => {
  it('保存データが無ければ最新スキーマを作り、バックアップも即時保存もしない', async () => {
    const d = deps(null)

    const db = await openMigratedDatabase(d)

    expect(getUserVersion(db)).toBe(2)
    expect(d.saveBackup).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })

  it('最新のDBは、バックアップも即時保存もしない', async () => {
    const d = deps(await createV1Bytes(2))

    await openMigratedDatabase(d)

    expect(d.saveBackup).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })

  it('古いDBは、流す前に元のバイト列をバックアップし、移行後に直ちに保存する(外部キー制約は有効に戻る)', async () => {
    const original = await createV1Bytes()
    const d = deps(original)
    const order: string[] = []
    d.saveBackup.mockImplementation(async () => void order.push('backup'))
    d.save.mockImplementation(async () => void order.push('save'))

    const db = await openMigratedDatabase(d)

    expect(order).toEqual(['backup', 'save'])
    expect(d.saveBackup).toHaveBeenCalledWith(original)
    expect(getUserVersion(db)).toBe(2)
    expect(db.exec('SELECT a FROM t')[0].values).toEqual([['keep']])
    expect(db.exec('PRAGMA foreign_keys')[0].values[0][0]).toBe(1)
    const saved = (d.save.mock.calls[0] as unknown as [Uint8Array])[0]
    expect(getUserVersion(await openFromBytes(saved))).toBe(2)
  })

  it('最新より新しいバージョンのDBはschema-too-newで拒否し、元のバイト列を添える', async () => {
    const original = await createV1Bytes(3)
    const d = deps(original)

    const error = await openMigratedDatabase(d).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(StartupDatabaseError)
    const e = error as StartupDatabaseError
    expect(e.reason).toBe('schema-too-new')
    expect(e.databaseVersion).toBe(3)
    expect(e.latestVersion).toBe(2)
    expect(e.originalData).toEqual(original)
    expect(d.saveBackup).not.toHaveBeenCalled()
  })

  it('差分が失敗したらmigration-failedで、元のバイト列を添えて投げ、保存はしない', async () => {
    const original = await createV1Bytes()
    const d = deps(original, { plan: { ...plan, diffs: { 2: ['SELECT * FROM nope'] } } })

    const error = (await openMigratedDatabase(d).catch((e: unknown) => e)) as StartupDatabaseError

    expect(error).toBeInstanceOf(StartupDatabaseError)
    expect(error.reason).toBe('migration-failed')
    expect(error.originalData).toEqual(original)
    expect(error.message).toMatch(/nope/)
    expect(d.save).not.toHaveBeenCalled()
  })

  it('バックアップの保存に失敗したら、差分を流さずmigration-failedで止める', async () => {
    const original = await createV1Bytes()
    const d = deps(original)
    d.saveBackup.mockRejectedValue(new Error('quota exceeded'))

    const error = (await openMigratedDatabase(d).catch((e: unknown) => e)) as StartupDatabaseError

    expect(error.reason).toBe('migration-failed')
    expect(error.message).toMatch(/quota exceeded/)
    expect(error.originalData).toEqual(original)
    expect(d.save).not.toHaveBeenCalled()
  })

  it('移行後の保存に失敗したら、migration-failedで止める', async () => {
    const original = await createV1Bytes()
    const d = deps(original)
    d.save.mockRejectedValue(new Error('disk full'))

    const error = (await openMigratedDatabase(d).catch((e: unknown) => e)) as StartupDatabaseError

    expect(error.reason).toBe('migration-failed')
    expect(error.originalData).toEqual(original)
  })

  it('読み取り専用のタブでは、メモリ上でだけ移行し、バックアップも保存もしない', async () => {
    const d = deps(await createV1Bytes(), { writable: false })

    const db = await openMigratedDatabase(d)

    expect(getUserVersion(db)).toBe(2)
    expect(d.saveBackup).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })
})
