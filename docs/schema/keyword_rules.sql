-- keyword_rules のDDL(計画Issue #219)。ドメイン定義は docs/domain/counterparties.md 1.3、
-- 設計判断は docs/decisions.md 2026-11-16 を参照
-- 摘要のキーワード(部分一致)から、取引先(任意)と相手科目(任意)を推定するルール。
-- 取引先は取引先マスタ、相手科目は勘定科目に紐づく。旧 counterparty_patterns の後継
CREATE TABLE keyword_rules (
  id               INTEGER PRIMARY KEY,
  pattern          TEXT NOT NULL,
  counterparty_id  INTEGER REFERENCES counterparties(id) ON DELETE CASCADE,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- 取引先か相手科目の少なくとも一方は必須
  CHECK (counterparty_id IS NOT NULL OR account_id IS NOT NULL)
);

CREATE INDEX idx_keyword_rules_counterparty ON keyword_rules(counterparty_id);
CREATE INDEX idx_keyword_rules_account ON keyword_rules(account_id);

-- 取引先と相手科目を両方指定できるのは、科目が収益・費用のときだけ
-- (取引先は収益・費用の行にしか付けられない制約と同じ。docs/schema/journal.sql 参照)
CREATE TRIGGER prevent_keyword_rule_counterparty_on_non_pl_account_insert
BEFORE INSERT ON keyword_rules
WHEN NEW.counterparty_id IS NOT NULL AND NEW.account_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'keyword rule with counterparty requires a revenue/expense account');
END;

CREATE TRIGGER prevent_keyword_rule_counterparty_on_non_pl_account_update
BEFORE UPDATE ON keyword_rules
WHEN NEW.counterparty_id IS NOT NULL AND NEW.account_id IS NOT NULL
  AND (SELECT category FROM accounts WHERE id = NEW.account_id) NOT IN ('revenue', 'expense')
BEGIN
  SELECT RAISE(ABORT, 'keyword rule with counterparty requires a revenue/expense account');
END;
