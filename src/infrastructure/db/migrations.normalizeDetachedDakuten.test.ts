/**
 * スキーマ v9 → v10(キーワードの、分離した濁点の再正規化)と v10 → v11(取込済みの摘要の、分離した濁点の整形)の差分のテスト
 * (計画Issue #279)。どちらも表の形は変えない。
 * v10: keyword_rules.pattern を、空白をはさんだ分離した濁点・半濁点も1文字にそろえる照合用の正規化にそろえ直す。
 *      重なったときは、v3・v4・v7と同じく、同じ取引先なら科目付き優先で1件にまとめ、別の取引先なら両方残す。
 * v11: 取込済み(source_type = external_import)の仕訳の摘要 journal_entries.memo の「シ 濁点」を「ジ」にする。
 *      手入力など他の仕訳の摘要と、突合用の external_transaction_refs.description は変えない。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, LATEST_SCHEMA_VERSION, getUserVersion, runMigrations } from './migrations'
import { toSchemaV11 } from './schemaV5ForTests'

/** v9 のDB(最新のDDLを流し、user_version = 9にしたもの。v10・v11は表の形を変えない。v12で足した列は取り除く) */
async function createV9Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV11(sql))
  db.run('PRAGMA user_version = 9')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO counterparties (id, name) VALUES (1, 'YJカード'), (2, '別の取引先')")
  db.run("INSERT INTO accounts (id, category, name, is_reconcilable) VALUES (10, 'expense', '雑費', NULL)")
  return db
}

const rules = (db: Database) => db.exec('SELECT id, pattern, counterparty_id, account_id FROM keyword_rules ORDER BY id')[0]?.values ?? []
const memos = (db: Database) => (db.exec('SELECT id, memo FROM journal_entries ORDER BY id')[0]?.values ?? []).map((v) => [v[0], v[1]])

describe('スキーマ v9 → v10(キーワードの分離した濁点の再正規化)', () => {
  it('分離した濁点を含むキーワードが1文字にそろい、バージョンが最新になる', async () => {
    const db = await createV9Database()
    db.run("INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES (1, 'ワイシ ゙エイカート ゙', 1, NULL)")

    runMigrations(db)

    expect(rules(db)).toEqual([[1, 'ワイジエイカード', 1, null]])
    expect(getUserVersion(db)).toBe(LATEST_SCHEMA_VERSION)
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(11)
  })

  it('同じ取引先で、分離した濁点と1文字の濁点のキーワードが重なれば1件にまとまり、科目付きを残す', async () => {
    const db = await createV9Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ワイジェイカード', 1, NULL),
         (2, 'ワイシ ゙エイカート ゙', 1, 10)`,
    )

    runMigrations(db)

    expect(rules(db)).toEqual([[2, 'ワイジエイカード', 1, 10]])
  })

  it('別の取引先に同じ文字列があれば、どちらも残す', async () => {
    const db = await createV9Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ワイジェイカード', 1, NULL),
         (2, 'ワイシ ゙エイカート ゙', 2, NULL)`,
    )

    runMigrations(db)

    expect(rules(db)).toEqual([
      [1, 'ワイジエイカード', 1, null],
      [2, 'ワイジエイカード', 2, null],
    ])
  })

  it('すでにそろっているキーワードは変わらない', async () => {
    const db = await createV9Database()
    db.run("INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES (1, 'ABC-123', 1, 10)")

    runMigrations(db)

    expect(rules(db)).toEqual([[1, 'ABC-123', 1, 10]])
  })
})

describe('スキーマ v10 → v11(取込済みの摘要の分離した濁点の整形)', () => {
  it('取込済みの仕訳の摘要の「シ 濁点」が「ジ」になり、ほかの空白は変わらない', async () => {
    const db = await createV9Database()
    db.run(
      `INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES
         (1, '2026-10-05', 'ワイシ ゙エイカート ゙(カ', 'external_import', 1),
         (2, '2026-10-06', 'ハ ﾟ ガス ホーム', 'external_import', 1)`,
    )

    runMigrations(db)

    expect(memos(db)).toEqual([
      [1, 'ワイジエイカード(カ'],
      [2, 'パ ガス ホーム'],
    ])
  })

  it('手入力など、取込でない仕訳の摘要は変えない', async () => {
    const db = await createV9Database()
    db.run("INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES (1, '2026-10-05', 'シ ゙', 'manual', 1)")

    runMigrations(db)

    expect(memos(db)).toEqual([[1, 'シ ゙']])
  })

  it('摘要が空(NULL)の取込済みの仕訳はそのまま', async () => {
    const db = await createV9Database()
    db.run("INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES (1, '2026-10-05', NULL, 'external_import', 1)")

    runMigrations(db)

    expect(memos(db)).toEqual([[1, null]])
  })
})
