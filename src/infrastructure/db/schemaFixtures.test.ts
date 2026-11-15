/**
 * 差分マイグレーションの書き忘れ検出テスト(計画Issue #42)。
 * 本番で公開した各バージョンのスキーマ+少量のデータを固定データ(schemaFixtures/v{N}.sql、
 * `npm run schema:freeze` が作る)として保存し、「固定データに差分を流した結果」と
 * 「最新スキーマから新規作成した結果」が、テーブル・列・インデックス・トリガー等の定義で一致することを確かめる。
 * 凍結後に差分の無いDDL変更をすると、ここで落ちる。外部依存: sql.js(Node上)。
 * 凍結前(フィクスチャ0件)は、実際の差分(v1→v2)と、書き忘れを検出できること自体を合成データで確かめる。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { SCHEMA_PLAN, runMigrations, type MigrationPlan } from './migrations'
import { findSchemaDifferences } from './schemaDifferences'

async function migrateFixture(fixtureSql: string, plan: MigrationPlan): Promise<Database> {
  const db = await createTestDatabase()
  db.run(fixtureSql)
  runMigrations(db, plan)
  return db
}

async function createFresh(plan: MigrationPlan): Promise<Database> {
  const db = await createTestDatabase()
  runMigrations(db, plan)
  return db
}

describe('スキーマの固定データ(フィクスチャ)と差分の整合', () => {
  const fixtures = import.meta.glob('./schemaFixtures/v*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >

  for (const [path, sql] of Object.entries(fixtures)) {
    it(`${path}に差分を流した結果が、最新スキーマからの新規作成と定義レベルで一致する`, async () => {
      const migrated = await migrateFixture(sql, SCHEMA_PLAN)
      const fresh = await createFresh(SCHEMA_PLAN)

      expect(findSchemaDifferences(migrated, fresh)).toEqual([])
    })
  }

  it('差分を書き忘れると食い違いとして検出される(列の追加・CHECK制約の変更)', async () => {
    const v1Sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, a INTEGER CHECK (a > 0));\nPRAGMA user_version = 1;'
    const latest = (db: Database) => db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, a INTEGER CHECK (a >= 0), b TEXT)')
    const withDiff: MigrationPlan = {
      latestVersion: 2,
      createLatest: latest,
      diffs: {
        2: [
          'CREATE TABLE t_new (id INTEGER PRIMARY KEY, a INTEGER CHECK (a >= 0), b TEXT)',
          'INSERT INTO t_new (id, a) SELECT id, a FROM t',
          'DROP TABLE t',
          'ALTER TABLE t_new RENAME TO t',
        ],
      },
    }
    const forgotten: MigrationPlan = { ...withDiff, diffs: {} }

    expect(findSchemaDifferences(await migrateFixture(v1Sql, withDiff), await createFresh(withDiff))).toEqual([])
    expect(findSchemaDifferences(await migrateFixture(v1Sql, forgotten), await createFresh(forgotten)).length).toBeGreaterThan(0)
  })
})
