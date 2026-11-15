/**
 * dumpDatabaseAsSql(db) のテスト(計画Issue #42)。スキーマ凍結用のフィクスチャ(スキーマ+少量のデータ)を
 * SQLテキストとして書き出す。書き出したSQLを空のDBに流すと、元のスキーマ・データ・user_versionが復元される。
 * 外部依存: sql.js(Node上、ネットワークなし)。
 */
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from './createTestDatabase'
import { dumpDatabaseAsSql } from './dumpDatabaseAsSql'
import { findSchemaDifferences } from './schemaDifferences'
import { getUserVersion } from './migrations'

describe('dumpDatabaseAsSql', () => {
  it('スキーマ・データ(文字列・数値・NULL・引用符を含む値)・user_versionを復元できるSQLを書き出す', async () => {
    const src = await createTestDatabase()
    src.run('CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT)')
    src.run('CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER REFERENCES p(id), memo TEXT, amount REAL)')
    src.run('CREATE INDEX idx_c ON c(p_id)')
    src.run('CREATE TRIGGER tr AFTER INSERT ON c BEGIN UPDATE p SET name = name WHERE id = NEW.p_id; END')
    src.run("INSERT INTO p (id, name) VALUES (1, 'O''Brien')")
    src.run('INSERT INTO c (id, p_id, memo, amount) VALUES (1, 1, NULL, 12.5)')
    src.run('PRAGMA user_version = 7')

    const dst = await createTestDatabase()
    dst.run(dumpDatabaseAsSql(src))

    expect(findSchemaDifferences(src, dst)).toEqual([])
    expect(dst.exec('SELECT name FROM p')[0].values).toEqual([["O'Brien"]])
    expect(dst.exec('SELECT memo, amount FROM c')[0].values).toEqual([[null, 12.5]])
    expect(getUserVersion(dst)).toBe(7)
  })

  it('外部キーの親子の順序に関係なく流し込める(読み込み側で外部キー検査を止める)', async () => {
    const src = await createTestDatabase()
    src.run('CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER REFERENCES b(id))')
    src.run('CREATE TABLE b (id INTEGER PRIMARY KEY)')
    src.run('INSERT INTO b (id) VALUES (1)')
    src.run('INSERT INTO a (id, b_id) VALUES (1, 1)')

    const dst = await createTestDatabase()
    expect(() => dst.run(dumpDatabaseAsSql(src))).not.toThrow()
    expect(dst.exec('SELECT COUNT(*) FROM a')[0].values[0][0]).toBe(1)
  })
})
