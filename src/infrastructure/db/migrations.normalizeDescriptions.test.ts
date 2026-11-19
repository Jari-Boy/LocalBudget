/**
 * スキーマ v3 → v4 の差分(摘要の標準化の続き)のテスト。表の形は変えず、次の2つを行う。
 * (1) 取り込み済みの仕訳(source_type = external_import)の摘要 journal_entries.memo を、半角カナ・全角英数・
 *     カタカナにつづくハイフンを標準化した形にする。手入力など、取り込みでない仕訳の摘要は変えない。
 *     突合用の記録(external_transaction_refs.description)はCSVの値のまま残す。
 * (2) キーワードマスタ keyword_rules.pattern を、ハイフンの標準化を加えた照合用の正規化にそろえ直す
 *     (v3の時点ではハイフンを標準化していなかった)。重なったときのまとめ方はv3と同じ。
 * 外部依存: sql.js(Node上)。
 */
import { describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { toSchemaV5 } from './schemaV5ForTests'
import { LATEST_SCHEMA_SQL, getUserVersion, runMigrations } from './migrations'

/** v3 のDB(最新のDDLを流し、user_version = 3にしたもの。v4は表の形を変えない) */
async function createV3Database(): Promise<Database> {
  const db = await createTestDatabase()
  // v6(計画Issue #231 フェーズ4)で足したお気に入りの列は、このバージョンには無いので取り除く
  for (const sql of LATEST_SCHEMA_SQL) db.run(toSchemaV5(sql))
  // v5(計画Issue #231 フェーズ3)で足した一時保存の表は、このバージョンには無いので取り除く
  db.run('DROP TABLE statement_import_draft_files')
  db.run('DROP TABLE statement_import_drafts')
  db.run('PRAGMA user_version = 3')
  db.run("INSERT INTO household_members (id, name) VALUES (1, '自分')")
  db.run("INSERT INTO counterparties (id, name) VALUES (1, 'ファミマ')")
  return db
}

const memos = (db: Database) => (db.exec('SELECT id, memo FROM journal_entries ORDER BY id')[0]?.values ?? []).map((v) => [v[0], v[1]])

describe('スキーマ v3 → v4(取り込み済みの仕訳の摘要・キーワードの標準化)', () => {
  it('取り込み済みの仕訳の摘要が標準化され、バージョンが4になる', async () => {
    const db = await createV3Database()
    db.run(
      `INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES
         (1, '2026-10-05', 'ﾌｧﾐﾘ-ﾏ-ﾄ Ｓｕｉｃａ', 'external_import', 1),
         (2, '2026-10-06', 'ﾓﾊﾞｲﾙ　ｓｕｉｃａ', 'external_import', 1)`,
    )

    runMigrations(db)

    expect(memos(db)).toEqual([
      [1, 'ファミリーマート Suica'],
      [2, 'モバイル suica'],
    ])
    expect(getUserVersion(db)).toBeGreaterThanOrEqual(4)
  })

  it('手入力など、取り込みでない仕訳の摘要は変えない', async () => {
    const db = await createV3Database()
    db.run(
      `INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES
         (1, '2026-10-05', 'ﾒﾓ ｍａｎｕａｌ', 'manual', 1)`,
    )

    runMigrations(db)

    expect(memos(db)).toEqual([[1, 'ﾒﾓ ｍａｎｕａｌ']])
  })

  it('摘要が空(NULL)の取り込み済みの仕訳はそのまま', async () => {
    const db = await createV3Database()
    db.run("INSERT INTO journal_entries (id, entry_date, memo, source_type, household_member_id) VALUES (1, '2026-10-05', NULL, 'external_import', 1)")

    runMigrations(db)

    expect(memos(db)).toEqual([[1, null]])
  })

  it('キーワードのハイフンも長音にそろい、同じ取引先で重なるものは1件にまとまる', async () => {
    const db = await createV3Database()
    db.run(
      `INSERT INTO keyword_rules (id, pattern, counterparty_id) VALUES
         (1, 'ファミリ-マ-ト', 1),
         (2, 'ファミリーマート', 1),
         (3, 'ABC-123', 1)`,
    )

    runMigrations(db)

    expect(db.exec('SELECT id, pattern FROM keyword_rules ORDER BY id')[0].values).toEqual([
      [1, 'ファミリーマート'],
      [3, 'ABC-123'],
    ])
  })
})
