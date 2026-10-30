/**
 * assertValidDatabaseSchema のユニットテスト。バックアップファイルのインポート
 * (計画Issue #26)時、アップロードされたDBが実際にLocalBudgetのスキーマを持つかを
 * 検証する関数を検証する。runMigrations単体では既にPRAGMA user_versionが最新の
 * DBに対してCREATE TABLE群を実行せず検証にならない(migrations.ts参照)ため、
 * migrations.tsが適用する9つのスキーマファイル(docs/schema/*.sql)それぞれの
 * 代表テーブルの存在を直接確認する。さらに、計画Issue #132でjournal_entry_linksを仕訳単位
 * (from_entry_id/to_entry_id)から明細行単位(from_line_id/to_line_id)へ変更したため、
 * 旧形式のテーブルを持つバックアップが弾かれることも確認する。
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

  it('LocalBudgetのスキーマと無関係なテーブルしか持たないDBに対してはInvalidBackupFileErrorを投げる', async () => {
    db = await createTestDatabase()
    db.run('CREATE TABLE unrelated_table (id INTEGER PRIMARY KEY)')

    expect(() => assertValidDatabaseSchema(db)).toThrow(InvalidBackupFileError)
  })

  it('journal_entry_linksが旧形式(仕訳単位のfrom_entry_id/to_entry_id)のDBに対してはInvalidBackupFileErrorを投げる(計画Issue #132)', async () => {
    db = await createTestDatabase()
    runMigrations(db)
    db.run('DROP TABLE journal_entry_links')
    db.run(`CREATE TABLE journal_entry_links (
      id            INTEGER PRIMARY KEY,
      from_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      to_entry_id   INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      link_type     TEXT NOT NULL CHECK (link_type IN ('settles', 'allocates')),
      amount        INTEGER NOT NULL CHECK (amount > 0),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    expect(() => assertValidDatabaseSchema(db)).toThrow(InvalidBackupFileError)
    expect(() => assertValidDatabaseSchema(db)).toThrow(/from_line_id/)
  })
})
