/**
 * assertValidDatabaseSchema のユニットテスト。バックアップファイルのインポート
 * (計画Issue #26)時、アップロードされたDBが実際にLocalBudgetのスキーマを持つかを
 * 検証する関数を検証する。runMigrations単体では既にPRAGMA user_versionが最新の
 * DBに対してCREATE TABLE群を実行せず検証にならない(migrations.ts参照)ため、
 * migrations.tsが適用する10個のスキーマファイル(docs/schema/*.sql、計画Issue #133で
 * settlement_batchesを追加)それぞれの代表テーブルの存在を直接確認する。
 * 計画Issue #169で、journal_lines.household_member_idがNOT NULLになった。移行は行わないため、
 * 旧スキーマ(NULL許容)のバックアップは取り込めないことも検証する。
 * 外部依存: sql.js(ネットワークアクセスなし、createTestDatabaseでNode上に生成)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../db/createTestDatabase'
import { runMigrations } from '../db/migrations'
import { assertValidDatabaseSchema } from './assertValidDatabaseSchema'
import { InvalidBackupFileError } from './InvalidBackupFileError'

let db: Database

describe('assertValidDatabaseSchema', () => {
  it('マイグレーション適用済みのDBに対しては例外を投げない', async () => {
    db = await createTestDatabase()
    runMigrations(db)

    expect(() => assertValidDatabaseSchema(db)).not.toThrow()
  })

  it('テーブルが1つも存在しない空のDBに対してはInvalidBackupFileErrorを投げる', async () => {
    db = await createTestDatabase()

    expect(() => assertValidDatabaseSchema(db)).toThrow(InvalidBackupFileError)
  })

  it('journal_lines.household_member_idがNULL許容の旧スキーマのDBは、InvalidBackupFileErrorを投げる(旧バックアップの取込は対象外、計画Issue #169)', async () => {
    db = await createTestDatabase()
    runMigrations(db)
    // 旧スキーマを模す: NOT NULLの無いjournal_linesに作り直す
    db.run('PRAGMA foreign_keys = OFF')
    db.run('DROP TABLE journal_lines')
    db.run(
      `CREATE TABLE journal_lines (
         id INTEGER PRIMARY KEY,
         journal_entry_id INTEGER NOT NULL,
         account_id INTEGER NOT NULL,
         household_member_id INTEGER,
         side TEXT NOT NULL,
         amount INTEGER NOT NULL
       )`,
    )

    expect(() => assertValidDatabaseSchema(db)).toThrow(InvalidBackupFileError)
    expect(() => assertValidDatabaseSchema(db)).toThrow(/household_member_id/)
  })

  it('LocalBudgetのスキーマと無関係なテーブルしか持たないDBに対してはInvalidBackupFileErrorを投げる', async () => {
    db = await createTestDatabase()
    db.run('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)')

    expect(() => assertValidDatabaseSchema(db)).toThrow(InvalidBackupFileError)
  })
})
