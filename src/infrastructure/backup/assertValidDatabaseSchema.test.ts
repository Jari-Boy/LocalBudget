/**
 * assertValidDatabaseSchema のユニットテスト。バックアップファイルのインポート
 * (計画Issue #26)時、アップロードされたDBが実際にLocalBudgetのスキーマを持つかを
 * 検証する関数を検証する。runMigrations単体では既にPRAGMA user_versionが最新の
 * DBに対してCREATE TABLE群を実行せず検証にならない(migrations.ts参照)ため、
 * migrations.tsが適用する9つのスキーマファイル(docs/schema/*.sql)それぞれの
 * 代表テーブルの存在を直接確認する。
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
})
