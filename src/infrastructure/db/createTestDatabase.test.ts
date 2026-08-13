/**
 * createTestDatabase の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、FK制約(PRAGMA foreign_keys = ON)が
 * 有効化されており、存在しない参照先を指す行の挿入がエラーになることを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { describe, expect, it } from 'vitest'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'

describe('createTestDatabase', () => {
  it('外部キー制約の強制を有効化する', async () => {
    const db = await createTestDatabase()
    runMigrations(db)

    db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
    const memberId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
    db.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [
      memberId,
    ])
    const entryId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number

    expect(() =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, side, amount)
         VALUES (?, 9999, 'debit', 100)`,
        [entryId],
      ),
    ).toThrow()
  })
})
