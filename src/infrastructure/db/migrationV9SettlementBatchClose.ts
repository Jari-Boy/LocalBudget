import type { MigrationStep } from './migrations'

/**
 * スキーマ v8 → v9 の差分(精算バッチのクローズ、計画Issue #249)。
 * settlement_batches に is_active(既定は有効=クローズされていない)を足し、クローズ時の振替仕訳を記録する表
 * (settlement_batch_close_entries)を足す。既存のバッチはすべて有効のままになる(データの変換はしない)。
 * 残高が0のバッチも、利用者がクローズするまで未精算に並ぶ。
 *
 * この差分は凍結されたバージョンの記録なので、後から最新のDDL(docs/schema/*.sql)が変わっても書き換えない。
 */
export const MIGRATION_V9_SETTLEMENT_BATCH_CLOSE: readonly MigrationStep[] = [
  'ALTER TABLE settlement_batches ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE',
  `CREATE TABLE settlement_batch_close_entries (
     settlement_batch_id INTEGER NOT NULL REFERENCES settlement_batches(id),
     journal_entry_id    INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
     PRIMARY KEY (settlement_batch_id, journal_entry_id)
   )`,
  'CREATE INDEX idx_settlement_batch_close_entries_entry ON settlement_batch_close_entries(journal_entry_id)',
]
