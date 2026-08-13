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
  -- 起票者(この仕訳を切った主体)。NOT NULL(docs/domain/journal.md 1.1「起票者」)。
  -- journal_lines.household_member_id(明細の上書き)とは別の列で、科目に既定値が無く
  -- 明細側も未指定の行の実効メンバーのフォールバック先になる(household-members.md 1.2節)。
  household_member_id INTEGER NOT NULL REFERENCES household_members(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_entries_member ON journal_entries(household_member_id);

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

-- project_id には区分制約はない(household_member_idと同様、全区分で許可。projects.md 1.2参照)

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

-- 科目(accounts)に既定のhousehold_member_idが設定されている場合、その科目を使う明細行の
-- household_member_idは科目の既定値で強制的に確定させ、明細側での上書きを禁止する
-- (docs/domain/household-members.md 1.2節、計画Issue #88)。明細側がNULL(未指定、科目の
-- 既定値を継承)、または科目の既定値と同じ値を明示指定した場合は許可し、異なる値を
-- 明示指定した場合のみ拒否する(counterparty_idの区分制約と同じTRIGGERパターン)。
CREATE TRIGGER prevent_household_member_override_on_default_account_line_insert
BEFORE INSERT ON journal_lines
WHEN NEW.household_member_id IS NOT NULL
  AND (SELECT household_member_id FROM accounts WHERE id = NEW.account_id) IS NOT NULL
  AND NEW.household_member_id != (SELECT household_member_id FROM accounts WHERE id = NEW.account_id)
BEGIN
  SELECT RAISE(ABORT, 'household_member_id cannot override an account default household_member_id');
END;

CREATE TRIGGER prevent_household_member_override_on_default_account_line_update
BEFORE UPDATE ON journal_lines
WHEN NEW.household_member_id IS NOT NULL
  AND (SELECT household_member_id FROM accounts WHERE id = NEW.account_id) IS NOT NULL
  AND NEW.household_member_id != (SELECT household_member_id FROM accounts WHERE id = NEW.account_id)
BEGIN
  SELECT RAISE(ABORT, 'household_member_id cannot override an account default household_member_id');
END;

-- 貸借バランス(借方合計=貸方合計)はDBで強制しない。journal.md 1.3参照。
-- JournalEntryRepository がトランザクション書き込み前に検証する。

CREATE TABLE journal_entry_links (
  id              INTEGER PRIMARY KEY,
  from_entry_id   INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  to_entry_id     INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  link_type       TEXT NOT NULL CHECK (link_type IN ('settles', 'allocates')),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_entry_links_from ON journal_entry_links(from_entry_id);
CREATE INDEX idx_journal_entry_links_to   ON journal_entry_links(to_entry_id);

-- journal_entry_drafts / journal_entry_draft_lines のDDL
-- journal_entries とは異なり貸借バランス・NOT NULL制約を課さない(入力途中の状態を許容するため)
-- ドメイン定義・設計判断は docs/domain/journal.md 3章を参照

CREATE TABLE journal_entry_drafts (
  id           INTEGER PRIMARY KEY,
  purpose      TEXT NOT NULL DEFAULT 'manual_entry'
    CHECK (purpose IN ('manual_entry')),
  entry_date   TEXT,
  memo         TEXT,
  currency     TEXT,
  -- 起票者(journal_entries.household_member_id相当)。下書き段階では未入力状態を許容する
  -- ためNULL可(journal_entriesと異なりNOT NULLにしない、docs/domain/journal.md 3章の
  -- 「バランス制約と同様、必須化の対象外」方針、計画Issue #88)。確定時にNULLのままだと
  -- journal_entries.household_member_idのNOT NULL制約により確定操作が失敗する。
  household_member_id INTEGER REFERENCES household_members(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journal_entry_draft_lines (
  id                      INTEGER PRIMARY KEY,
  journal_entry_draft_id  INTEGER NOT NULL
    REFERENCES journal_entry_drafts(id) ON DELETE CASCADE,
  account_id              INTEGER
    REFERENCES accounts(id),
  project_id              INTEGER
    REFERENCES projects(id),
  household_member_id     INTEGER
    REFERENCES household_members(id),
  counterparty_id         INTEGER
    REFERENCES counterparties(id),
  side                    TEXT CHECK (side IS NULL OR side IN ('debit', 'credit')),
  amount                  INTEGER,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_entry_draft_lines_draft ON journal_entry_draft_lines(journal_entry_draft_id);

-- journal_entry_drafts.updated_at の自動更新
CREATE TRIGGER journal_entry_drafts_set_updated_at
AFTER UPDATE ON journal_entry_drafts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE journal_entry_drafts SET updated_at = datetime('now') WHERE id = NEW.id;
END;
