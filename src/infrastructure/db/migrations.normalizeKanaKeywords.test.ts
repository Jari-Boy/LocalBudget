/**
 * スキーマ v6 → v7 の差分(キーワードの、ひらがな・カタカナの小書き文字の統一。計画Issue #236)のテスト。
 * 表の形は変えず、keyword_rules.pattern を、小書き文字を大きい文字に、ひらがなをカタカナにそろえた照合用の正規化にそろえ直す。
 * ジェイアールとジエイアールのような、表記ゆれで別々に登録されたキーワードが、同じ取引先なら1件にまとまること
 * (科目付きを優先)、別の取引先なら両方残ること、すでにそろっているキーワードは変わらないことを検証する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { LATEST_SCHEMA_SQL, getUserVersion, runMigrations } from './migrations'

/** v6 のDB(最新のDDLを流し、user_version = 6にしたもの。v7は表の形を変えない) */
async function createV6Database(): Promise<Database> {
  const db = await createTestDatabase()
  for (const sql of LATEST_SCHEMA_SQL) db.run(sql)
  db.run('PRAGMA user_version = 6')
  db.run("INSERT INTO counterparties (id, name) VALUES (1, 'JR東日本'), (2, '東京メトロ')")
  db.run("INSERT INTO accounts (id, category, name, is_reconcilable) VALUES (10, 'expense', '交通費', NULL), (11, 'expense', '雑費', NULL)")
  return db
}

const rules = (db: Database) => db.exec('SELECT id, pattern, counterparty_id, account_id FROM keyword_rules ORDER BY id')[0]?.values ?? []

describe('スキーマ v6 → v7(キーワードの小書き文字・ひらがなの統一)', () => {
  it('小書き文字とひらがなのキーワードが、大きいカタカナの正規化にそろい、バージョンが7になる', async () => {
    const db = await createV6Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ジェイアール', 1, NULL),
         (2, 'すいかちゃーじ', 2, NULL)`,
    )

    runMigrations(db)

    expect(rules(db)).toEqual([
      [1, 'ジエイアール', 1, null],
      [2, 'スイカチヤージ', 2, null],
    ])
    expect(getUserVersion(db)).toBeGreaterThanOrEqual(7)
  })

  it('同じ取引先で、表記ゆれのキーワードが重なれば1件にまとまり、科目付きを残す', async () => {
    const db = await createV6Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ジェイアール', 1, NULL),
         (2, 'ジエイアール', 1, 10)`,
    )

    runMigrations(db)

    expect(rules(db)).toEqual([[2, 'ジエイアール', 1, 10]])
  })

  it('別の取引先に同じ文字列があれば、どちらも残す', async () => {
    const db = await createV6Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ジェイアール', 1, NULL),
         (2, 'ジエイアール', 2, NULL)`,
    )

    runMigrations(db)

    expect(rules(db)).toEqual([
      [1, 'ジエイアール', 1, null],
      [2, 'ジエイアール', 2, null],
    ])
  })

  it('すでにそろっているキーワードは変わらない', async () => {
    const db = await createV6Database()
    db.run("INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES (1, 'ABC-123', 1, 10)")

    runMigrations(db)

    expect(rules(db)).toEqual([[1, 'ABC-123', 1, 10]])
  })
})
