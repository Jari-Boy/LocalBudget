import type { MigrationStep } from './migrations'

/**
 * スキーマ v7 → v8 の差分(割勘対象行の記録の表の追加、計画Issue #271)。
 * 割勘仕訳が元のどの明細行を割ったかを残す表(expense_split_source_lines)と、記録がある行の
 * 金額・科目・貸借の変更を拒否するトリガーを足す。既存の割勘仕訳は記録を持たない(行の特定ができないため)ので、
 * 従来どおり仕訳単位の割勘済みとして扱われる(データの変換はしない)。
 *
 * この差分は凍結されたバージョンの記録なので、後から最新のDDL(docs/schema/journal.sql)が変わっても書き換えない。
 */
export const MIGRATION_V8_EXPENSE_SPLIT_SOURCE_LINES: readonly MigrationStep[] = [
  `CREATE TABLE expense_split_source_lines (
     split_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
     source_line_id INTEGER NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
     PRIMARY KEY (split_entry_id, source_line_id)
   )`,
  'CREATE INDEX idx_expense_split_source_lines_source ON expense_split_source_lines(source_line_id)',
  `CREATE TRIGGER prevent_change_on_expense_split_source_line
   BEFORE UPDATE ON journal_lines
   WHEN (NEW.side != OLD.side OR NEW.amount != OLD.amount)
     AND EXISTS (SELECT 1 FROM expense_split_source_lines WHERE source_line_id = OLD.id)
   BEGIN
     SELECT RAISE(ABORT, 'expense split source line cannot change side or amount');
   END`,
]
