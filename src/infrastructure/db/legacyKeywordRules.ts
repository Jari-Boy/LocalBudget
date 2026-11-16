import type { Database } from 'sql.js'
import keywordRulesSql from '../../../docs/schema/keyword_rules.sql?raw'

/**
 * 旧形式のDB・バックアップを、キーワードルール(keyword_rules)へ変換する暫定処理(計画Issue #219)。
 * 本番前(スキーマ凍結前)は差分マイグレーションを使わずDDLを直接直すため、旧形式の開発用DBと
 * 旧形式のバックアップは、起動時・バックアップ読み込み時(runMigrations)にここで変換する。次の2つを冪等に行う。
 * 1. 旧 counterparty_patterns 表の各行を、取引先付きのルールへ写して旧表を削除する。
 * 2. 取引先の旧 default_account_id(取引先の既定の科目。決定10で廃止)を、その取引先のルールの科目
 *    (account_idが空のもの)へ移し、列の値は消す。収益・費用以外の科目は、取引先と併記できないため移さない。
 *    旧DBの counterparties には default_account_id の列が残るが、使わない(SQLiteは外部キーの列を
 *    DROP COLUMNできず、凍結前の暫定措置のため、表の作り直しはしない)。
 * 凍結時の後片付けで取り除く(docs/guides/schema-migration.md)。
 */
export function convertLegacyCounterpartyPatterns(db: Database): void {
  const hasPatterns = tableExists(db, 'counterparty_patterns')
  const hasLegacyDefaults = hasLegacyDefaultAccounts(db)
  if (!hasPatterns && !hasLegacyDefaults) return

  db.run('BEGIN')
  try {
    if (!tableExists(db, 'keyword_rules')) db.run(keywordRulesSql)
    if (hasPatterns) {
      db.run(
        `INSERT INTO keyword_rules (pattern, counterparty_id, created_at)
         SELECT pattern, counterparty_id, created_at FROM counterparty_patterns ORDER BY id`,
      )
      db.run('DROP TABLE counterparty_patterns')
    }
    if (columnExists(db, 'counterparties', 'default_account_id')) {
      db.run(
        `UPDATE keyword_rules
         SET account_id = (SELECT default_account_id FROM counterparties c WHERE c.id = keyword_rules.counterparty_id)
         WHERE account_id IS NULL
           AND counterparty_id IS NOT NULL
           AND (SELECT a.category FROM counterparties c JOIN accounts a ON a.id = c.default_account_id
                WHERE c.id = keyword_rules.counterparty_id) IN ('revenue', 'expense')`,
      )
      db.run('UPDATE counterparties SET default_account_id = NULL WHERE default_account_id IS NOT NULL')
    }
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
}

function tableExists(db: Database, name: string): boolean {
  return db.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [name]).length > 0
}

function columnExists(db: Database, table: string, column: string): boolean {
  const rows = db.exec(`PRAGMA table_info(${table})`)[0]?.values ?? []
  return rows.some((row) => row[1] === column)
}

/** 取引先の旧default_account_idに、まだ移していない値が残っているか */
function hasLegacyDefaultAccounts(db: Database): boolean {
  if (!columnExists(db, 'counterparties', 'default_account_id')) return false
  return db.exec('SELECT 1 FROM counterparties WHERE default_account_id IS NOT NULL LIMIT 1').length > 0
}
