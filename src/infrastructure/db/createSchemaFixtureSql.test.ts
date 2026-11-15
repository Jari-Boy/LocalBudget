/**
 * createSchemaFixtureSql(スキーマ凍結用フィクスチャの生成、計画Issue #42)のテスト。
 * 現在の最新スキーマから新規DBを作り、起動時の初期投入(seed)でひと通りのデータを入れて、
 * そのまま流し込めるSQLテキストにする。`npm run schema:freeze` が schemaFixtures/v{N}.sql に保存する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import { createSchemaFixtureSql, schemaFixtureFileName } from './createSchemaFixtureSql'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_VERSION, SCHEMA_PLAN, getUserVersion, runMigrations } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'

describe('createSchemaFixtureSql', () => {
  it('流し込むと、最新スキーマ・最新のuser_version・初期投入のデータが復元される', async () => {
    const sql = await createSchemaFixtureSql(createTestDatabase)

    const restored = await createTestDatabase()
    restored.run(sql)
    const fresh = await createTestDatabase()
    runMigrations(fresh, SCHEMA_PLAN)

    expect(getUserVersion(restored)).toBe(LATEST_SCHEMA_VERSION)
    expect(findSchemaDifferences(restored, fresh)).toEqual([])
    expect(restored.exec('SELECT COUNT(*) FROM household_members')[0].values[0][0]).toBeGreaterThan(0)
    expect(restored.exec('SELECT COUNT(*) FROM accounts')[0].values[0][0]).toBeGreaterThan(0)
  })

  it('復元したDBに外部キー違反が無い', async () => {
    const restored = await createTestDatabase()
    restored.run(await createSchemaFixtureSql(createTestDatabase))

    expect(restored.exec('PRAGMA foreign_key_check')).toEqual([])
  })
})

describe('schemaFixtureFileName', () => {
  it('バージョン番号からフィクスチャのファイル名を作る', () => {
    expect(schemaFixtureFileName(1)).toBe('v1.sql')
    expect(schemaFixtureFileName(12)).toBe('v12.sql')
  })
})
