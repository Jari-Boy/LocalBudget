-- journal_entries / journal_lines / journal_entry_links(明細行単位) のDDL
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
  -- 精算バッチのタグ(計画Issue #133)。project_idとは独立したカラムであり、1行に
  -- 両方を同時に設定できる(例: 割勘仕訳の費用行はproject_id(イベント)、立替金行は
  -- settlement_batch_id(精算バッチ)をそれぞれ持つ)。未精算残高は
  -- (settlement_batch_id, account_id, household_member_id/counterparty_id)の
  -- 集計で算出する(docs/domain/settlement.md参照)。
  settlement_batch_id   INTEGER
    REFERENCES settlement_batches(id),
  side                  TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_journal_lines_entry            ON journal_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account          ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_project          ON journal_lines(project_id);
CREATE INDEX idx_journal_lines_member           ON journal_lines(household_member_id);
CREATE INDEX idx_journal_lines_counterparty     ON journal_lines(counterparty_id);
CREATE INDEX idx_journal_lines_settlement_batch ON journal_lines(settlement_batch_id);

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

-- 関連仕訳グループ(多対多、計画Issue #138)。journal_entry_links(明細行単位のsettles/allocates
-- リンク)は計画Issue #138で完全に撤廃した。残高計算・消込判定の役割は計画Issue #133で
-- settlement_batch_idタグの集計方式に移管済みであり、残っていた表示系の役割(関連仕訳の
-- 一覧表示)は以下の多対多グループに置き換わった(経緯はdocs/decisions.md参照)。
-- 「関連仕訳を
-- ユーザーが一覧表示できる」役割を置き換える表示専用の軽量なグルーピング。link_type(種別タグ)
-- は持たず、残高計算・消込判定には一切関与しない。1つの仕訳(journal_entries)が複数のグループに
-- 同時に所属できる(所属数の上限なし)。ドメイン定義はdocs/domain/journal.md 1.8を参照。
CREATE TABLE journal_entry_link_groups (
  id         INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE journal_entry_link_group_memberships (
  id               INTEGER PRIMARY KEY,
  link_group_id    INTEGER NOT NULL REFERENCES journal_entry_link_groups(id) ON DELETE CASCADE,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (link_group_id, journal_entry_id)
);

CREATE INDEX idx_journal_entry_link_group_memberships_group ON journal_entry_link_group_memberships(link_group_id);
CREATE INDEX idx_journal_entry_link_group_memberships_entry ON journal_entry_link_group_memberships(journal_entry_id);

-- メンバーが0件になったグループ(全メンバーの仕訳が削除された等)は自動的に削除する
-- (計画Issue #138の懸念点「グループに所属する仕訳が0件になった場合の後始末」への対応)。
CREATE TRIGGER journal_entry_link_groups_delete_when_empty
AFTER DELETE ON journal_entry_link_group_memberships
WHEN NOT EXISTS (
  SELECT 1 FROM journal_entry_link_group_memberships WHERE link_group_id = OLD.link_group_id
)
BEGIN
  DELETE FROM journal_entry_link_groups WHERE id = OLD.link_group_id;
END;

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
