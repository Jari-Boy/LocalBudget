/**
 * runMigrations(db, plan) の差分マイグレーション機構のテスト(計画Issue #42)。
 * 実アプリの差分ではなく、テスト用の小さな MigrationPlan(最新スキーマの作成関数と差分の表)を渡して、
 * 新規作成・差分適用(SQL/TypeScript関数)・失敗時の巻き戻し・新しいバージョンの拒否を検証する。
 * 外部依存: sql.js(Node上、ネットワークなし)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { getUserVersion, needsMigration, runMigrations, type MigrationPlan } from './migrations'
import { MigrationFailedError, SchemaTooNewError } from './migrationErrors'

/** 最新(v3)は t(id, a, b, c)。v1は t(id, a)、v2でb、v3でcを足す */
function createPlan(overrides: MigrationPlan['diffs'] = {}): MigrationPlan {
  return {
    latestVersion: 3,
    createLatest: (db) => db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT, c TEXT)'),
    diffs: {
      2: ['ALTER TABLE t ADD COLUMN b TEXT'],
      3: [(db: Database) => db.run('ALTER TABLE t ADD COLUMN c TEXT'), `UPDATE t SET c = 'x'`],
      ...overrides,
    },
  }
}

async function createV1Database(): Promise<Database> {
  const db = await createTestDatabase()
  db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)')
  db.run(`INSERT INTO t (a) VALUES ('keep')`)
  db.run('PRAGMA user_version = 1')
  return db
}

function columnsOf(db: Database): string[] {
  return db.exec('PRAGMA table_info(t)')[0].values.map((row) => row[1] as string)
}

describe('runMigrations(plan)', () => {
  it('空のDBは最新スキーマをそのまま作成し、user_versionを最新にする(差分は流さない)', async () => {
    const db = await createTestDatabase()

    runMigrations(db, createPlan())

    expect(columnsOf(db)).toEqual(['id', 'a', 'b', 'c'])
    expect(getUserVersion(db)).toBe(3)
  })

  it('既存DBにはバージョン順にSQLとTypeScript関数の両方の差分を流し、データを保つ', async () => {
    const db = await createV1Database()

    runMigrations(db, createPlan())

    expect(columnsOf(db)).toEqual(['id', 'a', 'b', 'c'])
    expect(db.exec('SELECT a, c FROM t')[0].values).toEqual([['keep', 'x']])
    expect(getUserVersion(db)).toBe(3)
  })

  it('最新のDBには何もしない', async () => {
    const db = await createTestDatabase()
    runMigrations(db, createPlan())

    expect(needsMigration(db, createPlan())).toBe(false)
    expect(() => runMigrations(db, createPlan())).not.toThrow()
  })

  it('needsMigrationは、既存DBで最新より古いときだけtrueを返す(空のDBはfalse)', async () => {
    expect(needsMigration(await createV1Database(), createPlan())).toBe(true)
    expect(needsMigration(await createTestDatabase(), createPlan())).toBe(false)
  })

  it('差分の途中で失敗するとDBは変更されず、MigrationFailedErrorを投げる', async () => {
    const db = await createV1Database()
    const plan = createPlan({ 3: ['CREATE TABLE u (x)', 'INSERT INTO no_such_table VALUES (1)'] })

    expect(() => runMigrations(db, plan)).toThrow(MigrationFailedError)

    expect(columnsOf(db)).toEqual(['id', 'a'])
    expect(getUserVersion(db)).toBe(1)
    expect(db.exec("SELECT name FROM sqlite_master WHERE name = 'u'")).toEqual([])
  })

  it('TypeScript関数の差分が例外を投げても巻き戻す', async () => {
    const db = await createV1Database()
    const plan = createPlan({
      2: [
        (d: Database) => {
          d.run('ALTER TABLE t ADD COLUMN b TEXT')
          throw new Error('boom')
        },
      ],
    })

    expect(() => runMigrations(db, plan)).toThrow(/boom/)

    expect(columnsOf(db)).toEqual(['id', 'a'])
  })

  it('差分の後に外部キー違反が残っていれば失敗として巻き戻す', async () => {
    const db = await createTestDatabase()
    db.run('CREATE TABLE p (id INTEGER PRIMARY KEY)')
    db.run('CREATE TABLE ch (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id))')
    db.run('INSERT INTO p (id) VALUES (1)')
    db.run('INSERT INTO ch (id, p_id) VALUES (1, 1)')
    db.run('PRAGMA user_version = 1')
    const plan: MigrationPlan = {
      latestVersion: 2,
      createLatest: () => {},
      // 外部キー検査を止めた状態で親だけを消す(テーブル作り直しの失敗を模す)
      diffs: { 2: ['DELETE FROM p'] },
    }

    expect(() => runMigrations(db, plan)).toThrow(MigrationFailedError)

    expect(db.exec('SELECT COUNT(*) FROM p')[0].values[0][0]).toBe(1)
    expect(getUserVersion(db)).toBe(1)
  })

  it('成功・失敗のどちらでも、終わったあとは外部キー制約が有効に戻る', async () => {
    const ok = await createV1Database()
    runMigrations(ok, createPlan())
    expect(ok.exec('PRAGMA foreign_keys')[0].values[0][0]).toBe(1)

    const ng = await createV1Database()
    expect(() => runMigrations(ng, createPlan({ 2: ['SELECT * FROM nope'] }))).toThrow()
    expect(ng.exec('PRAGMA foreign_keys')[0].values[0][0]).toBe(1)
  })

  it('最新より大きいuser_versionのDBはSchemaTooNewErrorで拒否し、何も変更しない', async () => {
    const db = await createV1Database()
    db.run('PRAGMA user_version = 4')

    let thrown: unknown
    try {
      runMigrations(db, createPlan())
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SchemaTooNewError)
    expect((thrown as SchemaTooNewError).databaseVersion).toBe(4)
    expect((thrown as SchemaTooNewError).latestVersion).toBe(3)
    expect(columnsOf(db)).toEqual(['id', 'a'])
  })
})
