/**
 * スキーマ v8 → v9 の差分(精算バッチのクローズ、計画Issue #249)のテスト。
 * is_active の列とクローズ時の振替仕訳の表(settlement_batch_close_entries)が無い v8 のDB(最新のDDLから該当の記述を
 * 取り除いて作る)に差分を流し、最新スキーマからの新規作成と定義レベルで一致すること、既存のバッチが
 * 有効(クローズされていない)として保たれること、振替仕訳の記録が仕訳の削除で消えることを検証する。外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'
import { toSchemaV8 } from './schemaV5ForTests'

/** v8 のDB(is_active と振替仕訳の表が無く、user_version = 8)を作り、既存の精算バッチと仕訳を入れる */
async function createV8Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV8(sql))
  db.run('PRAGMA user_version = 8')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO settlement_batches (id, name, type) VALUES (1, '10月の割勘', 'expense_splitting')")
  db.run("INSERT INTO journal_entries (id, entry_date, household_member_id) VALUES (1, '2026-11-01', 1)")
  return db
}

describe('スキーマ v8 → v9(精算バッチのクローズ)', () => {
  it('最新のスキーマのバージョンは9以上である', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(9)
  })

  it('v8のDBに差分を流すと、最新スキーマからの新規作成と定義レベルで一致し、バージョンが最新になる', async () => {
    const migrated = await createV8Database()
    runMigrations(migrated)
    const fresh = await createTestDatabase()
    runMigrations(fresh)

    expect(getUserVersion(migrated)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(migrated, fresh)).toEqual([])
  })

  it('既存の精算バッチは、クローズされていない(is_active = 1)として保たれる', async () => {
    const db = await createV8Database()
    runMigrations(db)

    expect(db.exec('SELECT is_active FROM settlement_batches WHERE id = 1')[0].values[0][0]).toBe(1)
  })

  it('振替仕訳の記録は、その仕訳を削除すると一緒に消える', async () => {
    const db = await createV8Database()
    runMigrations(db)
    db.run('INSERT INTO settlement_batch_close_entries (settlement_batch_id, journal_entry_id) VALUES (1, 1)')

    db.run('DELETE FROM journal_entries WHERE id = 1')

    expect(db.exec('SELECT COUNT(*) FROM settlement_batch_close_entries')[0].values[0][0]).toBe(0)
  })
})
