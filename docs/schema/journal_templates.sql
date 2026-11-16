-- 仕訳テンプレート(計画Issue #201)のDDL
-- ドメイン定義・設計判断は docs/domain/journal-templates.md を参照
-- 最新スキーマの一部として、新規DBにそのまま作成する(本番前のため、差分マイグレーションは持たない)

-- テンプレートのグループ。取引先・プロジェクトのグループ(project_groups)と同じ仕様:
-- 入れ子可・単一所属・表示専用。categoryは持たない
CREATE TABLE journal_template_groups (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  parent_group_id   INTEGER REFERENCES journal_template_groups(id),
  -- 同じ入れ物の中での表示順。サブグループと直属のテンプレートで1つの表示順を共有する
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_template_groups_parent ON journal_template_groups(parent_group_id);

-- グループ名は同じ親グループ内でユニーク(非アクティブは除外)。最上位はCOALESCEで0に束ねる
CREATE UNIQUE INDEX idx_journal_template_groups_unique_name
ON journal_template_groups(COALESCE(parent_group_id, 0), name)
WHERE is_active = TRUE;

-- 仕訳のひな形。繰り返し周期・提案の概念は持たない(定期仕訳との違い)。
-- 起票時に「新規仕訳」フォームへ内容を展開するだけで、仕訳(journal_entries)は参照しない
CREATE TABLE journal_templates (
  id                              INTEGER PRIMARY KEY,
  -- 名称は全テンプレートで一意(無効のものを含む)
  name                            TEXT NOT NULL UNIQUE,
  -- 起票時の摘要の初期値。任意
  memo                            TEXT,
  -- 起票者の初期値。NULLなら起票時に選ぶ(行の世帯メンバー(journal_template_lines側)とは別の概念)
  bookkeeper_household_member_id  INTEGER REFERENCES household_members(id),
  -- 所属グループ。NULL=未分類
  journal_template_group_id       INTEGER REFERENCES journal_template_groups(id),
  sort_order                      INTEGER NOT NULL DEFAULT 0,
  is_active                       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_templates_group ON journal_templates(journal_template_group_id);

-- テンプレートの行。仕訳の明細行のひな形で、2行のテンプレートも3行以上のテンプレートも同じ表で表す。
-- amountがNULLの行は「起票時に入力する」。全行の金額があるときだけ、Repositoryが貸借の一致を検証する
-- (assertJournalBalance。journal.md 1.3と同じ検証)。世帯メンバーはNULLなら「行では決めない」で、
-- 起票時に 科目の既定メンバー > 起票者 の順で決まる。精算バッチは、システム管理の未収金・未払金(精算バッチ)の
-- 科目の行にだけ設定できる(Repositoryが検証、journal_linesと同じ)。
-- account_idがNULLの行は「科目がまだ決まっていない行」(「テンプレートを追加」の直後は科目を空のまま作る)。
-- 画面の保存は科目が決まっていることを求めるが、DBとRepositoryは空を許す
CREATE TABLE journal_template_lines (
  id                       INTEGER PRIMARY KEY,
  journal_template_id      INTEGER NOT NULL REFERENCES journal_templates(id) ON DELETE CASCADE,
  line_no                  INTEGER NOT NULL CHECK (line_no >= 1),
  side                     TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  account_id               INTEGER REFERENCES accounts(id),
  amount                   INTEGER CHECK (amount IS NULL OR amount > 0),
  project_id               INTEGER REFERENCES projects(id),
  household_member_id      INTEGER REFERENCES household_members(id),
  counterparty_id          INTEGER REFERENCES counterparties(id),
  settlement_batch_id      INTEGER REFERENCES settlement_batches(id),
  UNIQUE (journal_template_id, line_no)
);

CREATE INDEX idx_journal_template_lines_template ON journal_template_lines(journal_template_id);

-- counterparty_id は revenue/expense の行にのみ設定可能(journal_linesと同じTRIGGER、counterparties.md 1.2参照)
CREATE TRIGGER prevent_counterparty_on_non_pl_template_line_insert
BEFORE INSERT ON journal_template_lines
WHEN NEW.counterparty_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'counterparty_id can only be set on revenue/expense lines');
END;

CREATE TRIGGER prevent_counterparty_on_non_pl_template_line_update
BEFORE UPDATE ON journal_template_lines
WHEN NEW.counterparty_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'counterparty_id can only be set on revenue/expense lines');
END;

-- 子グループまたは所属するテンプレートがあるグループは物理削除できない
CREATE TRIGGER prevent_delete_journal_template_group_with_children
BEFORE DELETE ON journal_template_groups
WHEN EXISTS (SELECT 1 FROM journal_template_groups WHERE parent_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a journal template group that has child groups');
END;

CREATE TRIGGER prevent_delete_journal_template_group_with_templates
BEFORE DELETE ON journal_template_groups
WHEN EXISTS (SELECT 1 FROM journal_templates WHERE journal_template_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete a journal template group that has templates');
END;

-- updated_at の自動更新
CREATE TRIGGER journal_template_groups_set_updated_at
AFTER UPDATE ON journal_template_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE journal_template_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER journal_templates_set_updated_at
AFTER UPDATE ON journal_templates
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE journal_templates SET updated_at = datetime('now') WHERE id = NEW.id;
END;
