/**
 * findSchemaDifferences(a, b) のテスト(計画Issue #42)。2つのDBのスキーマ(テーブル・列・外部キー・
 * CHECK制約・インデックス・トリガー・ビュー)を定義レベルで比べ、食い違いを文字列で返す。
 * 差分マイグレーションの書き忘れ検出の土台。書式の違い(空白・改行・コメント)や列の並びは差として扱わない。
 * 外部依存: sql.js(Node上、ネットワークなし)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { findSchemaDifferences } from './schemaDifferences'

async function dbWith(...statements: string[]): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of statements) db.run(sql)
  return db
}

describe('findSchemaDifferences', () => {
  it('同じスキーマなら差はない', async () => {
    const sql = 'CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT NOT NULL DEFAULT 0)'
    expect(findSchemaDifferences(await dbWith(sql), await dbWith(sql))).toEqual([])
  })

  it('空白・改行・コメントの書式差は無視する', async () => {
    const a = await dbWith('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT CHECK (a IN (1, 2)))')
    const b = await dbWith(`CREATE TABLE t (
      id INTEGER PRIMARY KEY, -- 主キー
      a TEXT CHECK(a IN (1,2))
    )`)
    expect(findSchemaDifferences(a, b)).toEqual([])
  })

  it('ALTER TABLE ADD COLUMNで足した列と、最初から定義した列(並びが違う)は同じとみなす', async () => {
    const altered = await dbWith('CREATE TABLE t (id INTEGER PRIMARY KEY, c TEXT)', 'ALTER TABLE t ADD COLUMN b TEXT')
    const created = await dbWith('CREATE TABLE t (id INTEGER PRIMARY KEY, b TEXT, c TEXT)')
    expect(findSchemaDifferences(altered, created)).toEqual([])
  })

  it('片方にしかないテーブルを検出する', async () => {
    const diffs = findSchemaDifferences(
      await dbWith('CREATE TABLE t (id)'),
      await dbWith('CREATE TABLE t (id)', 'CREATE TABLE u (id)'),
    )
    expect(diffs.join('\n')).toMatch(/table u/)
  })

  it('列の有無・型・NOT NULL・既定値の違いを検出する', async () => {
    const base = await dbWith('CREATE TABLE t (id INTEGER, a TEXT)')
    expect(findSchemaDifferences(base, await dbWith('CREATE TABLE t (id INTEGER)')).join('\n')).toMatch(/t\.a/)
    expect(findSchemaDifferences(base, await dbWith('CREATE TABLE t (id INTEGER, a INTEGER)')).join('\n')).toMatch(/t\.a/)
    expect(findSchemaDifferences(base, await dbWith('CREATE TABLE t (id INTEGER, a TEXT NOT NULL)')).join('\n')).toMatch(/t\.a/)
    expect(findSchemaDifferences(base, await dbWith(`CREATE TABLE t (id INTEGER, a TEXT DEFAULT 'x')`)).join('\n')).toMatch(/t\.a/)
  })

  it('CHECK制約の違いを検出する', async () => {
    const a = await dbWith('CREATE TABLE t (a INTEGER CHECK (a > 0))')
    const b = await dbWith('CREATE TABLE t (a INTEGER CHECK (a >= 0))')
    expect(findSchemaDifferences(a, b).join('\n')).toMatch(/check/i)
  })

  it('外部キーの違いを検出する', async () => {
    const parent = 'CREATE TABLE p (id INTEGER PRIMARY KEY)'
    const a = await dbWith(parent, 'CREATE TABLE t (p_id INTEGER REFERENCES p(id))')
    const b = await dbWith(parent, 'CREATE TABLE t (p_id INTEGER REFERENCES p(id) ON DELETE CASCADE)')
    expect(findSchemaDifferences(a, b).join('\n')).toMatch(/foreign key/i)
  })

  it('インデックス(UNIQUE・部分インデックス含む)の違いを検出する', async () => {
    const t = 'CREATE TABLE t (a TEXT, b TEXT)'
    const a = await dbWith(t, 'CREATE INDEX idx ON t(a)')
    expect(findSchemaDifferences(a, await dbWith(t)).join('\n')).toMatch(/index idx/)
    expect(findSchemaDifferences(a, await dbWith(t, 'CREATE UNIQUE INDEX idx ON t(a)')).join('\n')).toMatch(/index idx/)
    expect(
      findSchemaDifferences(a, await dbWith(t, 'CREATE INDEX idx ON t(a) WHERE b IS NOT NULL')).join('\n'),
    ).toMatch(/index idx/)
  })

  it('UNIQUE制約(自動インデックス)の違いを検出する', async () => {
    const a = await dbWith('CREATE TABLE t (a TEXT UNIQUE)')
    const b = await dbWith('CREATE TABLE t (a TEXT)')
    expect(findSchemaDifferences(a, b).length).toBeGreaterThan(0)
  })

  it('トリガーの有無・本文の違いを検出する', async () => {
    const t = 'CREATE TABLE t (a TEXT)'
    const trig = (body: string) => `CREATE TRIGGER tr AFTER INSERT ON t BEGIN ${body}; END`
    const a = await dbWith(t, trig('SELECT 1'))
    expect(findSchemaDifferences(a, await dbWith(t)).join('\n')).toMatch(/trigger tr/)
    expect(findSchemaDifferences(a, await dbWith(t, trig('SELECT 2'))).join('\n')).toMatch(/trigger tr/)
  })
})
