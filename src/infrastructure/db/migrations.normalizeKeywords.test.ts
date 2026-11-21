/**
 * スキーマ v2 → v3 の差分(キーワードマスタ keyword_rules.pattern の標準化)のテスト。
 * 表の形は変えず、既存のキーワードを照合用の正規化(NFKC・大文字化・空白除去)にそろえる。
 * 半角カナ・全角英数・空白を含むキーワードが標準化されること、標準化の結果が同じになる
 * 同じ取引先(または同じ科目)のキーワードが1件にまとまること(科目付きを優先)、
 * 別の取引先に同じ文字列があれば両方残ること、標準化済みのキーワードは変わらないことを検証する。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { toSchemaV5 } from './schemaV5ForTests'
import { LATEST_SCHEMA_SQL, runMigrations } from './migrations'

/** v2 のDB(最新のDDLを流し、user_version = 2にしたもの。v3は表の形を変えないので同じDDLになる) */
async function createV2Database(): Promise<Database> {
  const db = await createTestDatabase()
  // v6(計画Issue #231 フェーズ4)で足したお気に入りの列は、このバージョンには無いので取り除く
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV5(sql))
  // v5(計画Issue #231 フェーズ3)で足した一時保存の表は、このバージョンには無いので取り除く
  db.run('DROP TABLE statement_import_draft_files')
  db.run('DROP TABLE statement_import_drafts')
  db.run('PRAGMA user_version = 2')
  db.run("INSERT INTO counterparties (id, name) VALUES (1, 'JR東日本'), (2, 'ファミマ')")
  db.run("INSERT INTO accounts (id, category, name, is_reconcilable) VALUES (10, 'expense', '交通費', NULL), (11, 'asset', '現金', TRUE)")
  return db
}

const patterns = (db: Database) =>
  db.exec('SELECT id, pattern, counterparty_id, account_id FROM keyword_rules ORDER BY id')[0]?.values ?? []

describe('スキーマ v2 → v3(キーワードの標準化)', () => {
  it('半角カナ・全角英数・空白・小文字を含むキーワードが、照合用の正規化にそろう', async () => {
    const db = await createV2Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ﾓﾊﾞｲﾙ ｓｕｉｃａ', 1, 10),
         (2, 'ファミリー　マート', 2, NULL)`,
    )

    runMigrations(db)

    expect(patterns(db)).toEqual([
      [1, 'モバイルSUICA', 1, 10],
      // 最新の規則(計画Issue #236のv7)で、小書き文字は大きい文字にそろう(ファ → フア)
      [2, 'フアミリーマート', 2, null],
    ])
  })

  it('標準化すると同じになる同じ取引先のキーワードは1件にまとまり、科目付きを残す', async () => {
    const db = await createV2Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ﾓﾊﾞｲﾙSUICA', 1, NULL),
         (2, 'モバイルＳｕｉｃａ', 1, 10),
         (3, 'モバイルSUICA', 1, NULL)`,
    )

    runMigrations(db)

    expect(patterns(db)).toEqual([[2, 'モバイルSUICA', 1, 10]])
  })

  it('標準化すると同じになる科目だけのキーワードも、同じ科目の中で1件にまとまる', async () => {
    const db = await createV2Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ﾏｲﾊﾞｽｹｯﾄ', NULL, 11),
         (2, 'マイバスケット', NULL, 11)`,
    )

    runMigrations(db)

    expect(patterns(db)).toEqual([[1, 'マイバスケツト', null, 11]])
  })

  it('標準化すると同じになっても、別の取引先のキーワードは、どちらも残す', async () => {
    const db = await createV2Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id, account_id) VALUES
         (1, 'ｾﾌﾞﾝ', 1, NULL),
         (2, 'セブン', 2, NULL)`,
    )

    runMigrations(db)

    expect(patterns(db)).toEqual([
      [1, 'セブン', 1, null],
      [2, 'セブン', 2, null],
    ])
  })

  it('すでに標準化されているキーワードは変わらない', async () => {
    const db = await createV2Database()
    db.run("INSERT INTO keyword_rules (id, pattern, counterparty_id) VALUES (1, 'AMAZON', 1)")

    runMigrations(db)

    expect(patterns(db)).toEqual([[1, 'AMAZON', 1, null]])
  })
})
