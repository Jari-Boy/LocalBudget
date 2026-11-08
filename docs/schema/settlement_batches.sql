-- settlement_batches のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/settlement.md を参照(計画Issue #133)

CREATE TABLE settlement_batches (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL
    CHECK (type IN ('expense_splitting')),
  -- 世帯外の相手との割勘バッチにのみ設定する(docs/domain/settlement.md参照)。
  -- 世帯メンバー間のバッチはhousehold_member_idが明細行側に既にあるためnullのまま。
  counterparty_id  INTEGER REFERENCES counterparties(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_settlement_batches_counterparty ON settlement_batches(counterparty_id);

-- 仕訳明細が紐づく精算バッチの物理削除を禁止(projects.prevent_delete_project_with_journal_linesと同じパターン)
CREATE TRIGGER prevent_delete_settlement_batch_with_journal_lines
BEFORE DELETE ON settlement_batches
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE settlement_batch_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete settlement batch with journal lines');
END;

-- updated_at の自動更新
CREATE TRIGGER settlement_batches_set_updated_at
AFTER UPDATE ON settlement_batches
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settlement_batches SET updated_at = datetime('now') WHERE id = NEW.id;
END;
