import type { Database } from 'sql.js'
import keywordRulesSql from '../../../docs/schema/keyword_rules.sql?raw'

/**
 * 旧 counterparty_patterns 表を keyword_rules へ変換する暫定処理(計画Issue #219)。
 * 本番前(スキーマ凍結前)は差分マイグレーションを使わずDDLを直接直すため、旧形式の開発用DBと
 * 旧形式のバックアップは、起動時・バックアップ読み込み時(runMigrations)にここで変換する。
 * 旧表があるときだけ動き(冪等)、各行を「取引先付き・科目なし」のルールへ写して旧表を削除する。
 * 凍結時の後片付けで取り除く(docs/guides/schema-migration.md)。
 */
export function convertLegacyCounterpartyPatterns(db: Database): void {
  if (!tableExists(db, 'counterparty_patterns')) return

  db.run('BEGIN')
  try {
    if (!tableExists(db, 'keyword_rules')) db.run(keywordRulesSql)
    db.run(
      `INSERT INTO keyword_rules (pattern, counterparty_id, created_at)
       SELECT pattern, counterparty_id, created_at FROM counterparty_patterns ORDER BY id`,
    )
    db.run('DROP TABLE counterparty_patterns')
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

function tableExists(db: Database, name: string): boolean {
  return db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0
}
