-- journal_entries / journal_lines / journal_entry_links のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/journal.md を参照

CREATE TABLE journal_entries (
  id           INTEGER PRIMARY KEY,
  entry_date   TEXT NOT NULL,
  memo         TEXT,
  currency     TEXT NOT NULL DEFAULT 'JPY',
  source_type  TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN (
      'manual', 'external_import', 'recurring_generated',
      'initial_balance', 'balance_adjustment'
    )),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journal_lines (
  id                    INTEGER PRIMARY KEY,
  journal_entry_id      INTEGER NOT NULL
    REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id            INTEGER NOT NULL
    REFERENCES accounts(id),
  project_id            INTEGER
    REFERENCES projects(id),
  household_member_id   INTEGER
    REFERENCES household_members(id),
  counterparty_id       INTEGER
    REFERENCES counterparties(id),
  side                  TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_lines_entry        ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account      ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_project      ON journal_lines(project_id);
CREATE INDEX idx_journal_lines_member       ON journal_lines(household_member_id);
CREATE INDEX idx_journal_lines_counterparty ON journal_lines(counterparty_id);

-- journal_entries.updated_at の自動更新
CREATE TRIGGER journal_entries_set_updated_at
AFTER UPDATE ON journal_entries
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE journal_entries SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- project_id は revenue/expense の行にのみ設定可能
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装。実機検証済み: projects.md 1.2参照)
-- household_member_id には同様の区分制約はない(household-members.md 1.2の通り全区分で許可)
CREATE TRIGGER prevent_project_on_non_pl_line_insert
BEFORE INSERT ON journal_lines
WHEN NEW.project_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'project_id can only be set on revenue/expense lines');
END;

CREATE TRIGGER prevent_project_on_non_pl_line_update
BEFORE UPDATE ON journal_lines
WHEN NEW.project_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'project_id can only be set on revenue/expense lines');
END;

-- counterparty_id は revenue/expense の行にのみ設定可能
-- (project_id と同じ理由でTRIGGERによる実装、counterparties.md 1.2参照)
CREATE TRIGGER prevent_counterparty_on_non_pl_line_insert
BEFORE INSERT ON journal_lines
WHEN NEW.counterparty_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'counterparty_id can only be set on revenue/expense lines');
END;

CREATE TRIGGER prevent_counterparty_on_non_pl_line_update
BEFORE UPDATE ON journal_lines
WHEN NEW.counterparty_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'counterparty_id can only be set on revenue/expense lines');
END;

-- 貸借バランス(借方合計=貸方合計)はDBで強制しない。journal.md 1.3参照。
-- JournalEntryRepository がトランザクション書き込み前に検証する。

CREATE TABLE journal_entry_links (
  id              INTEGER PRIMARY KEY,
  from_entry_id   INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  to_entry_id     INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  link_type       TEXT NOT NULL CHECK (link_type IN ('settles', 'reverses')),
  amount          INTEGER CHECK (amount IS NULL OR amount > 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- settlesは金額必須、reversesは金額を持たない(全額の打ち消しのため)
  CHECK ((link_type = 'settles') = (amount IS NOT NULL))
);

CREATE INDEX idx_journal_entry_links_from ON journal_entry_links(from_entry_id);
CREATE INDEX idx_journal_entry_links_to   ON journal_entry_links(to_entry_id);
