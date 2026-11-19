import type { MigrationStep } from './migrations'

/**
 * スキーマ v4 → v5 の差分(明細取込の一時保存の表の追加、計画Issue #231 フェーズ3)。
 * 新しい表を足すだけで、既存の表・データは変えない。DDLは docs/schema/statement_import.sql の最新と同じ内容
 * (差分は凍結されたバージョンの記録なので、最新のDDLを参照せず、ここに写して持つ)。
 */
export const MIGRATION_V5_STATEMENT_IMPORT_DRAFTS: readonly MigrationStep[] = [
  `CREATE TABLE statement_import_drafts (
     id                INTEGER PRIMARY KEY,
     target_account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
     definition_id     INTEGER REFERENCES import_mapping_definitions(id) ON DELETE SET NULL,
     owner_member_id   INTEGER REFERENCES household_members(id) ON DELETE SET NULL,
     row_inputs        TEXT NOT NULL DEFAULT '{}',
     total_rows        INTEGER NOT NULL DEFAULT 0,
     filled_rows       INTEGER NOT NULL DEFAULT 0,
     created_at        TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE statement_import_draft_files (
     id         INTEGER PRIMARY KEY,
     draft_id   INTEGER NOT NULL REFERENCES statement_import_drafts(id) ON DELETE CASCADE,
     file_order INTEGER NOT NULL,
     file_name  TEXT NOT NULL,
     content    BLOB NOT NULL,
     is_checked BOOLEAN NOT NULL DEFAULT 1,
     UNIQUE (draft_id, file_order)
   )`,
]
