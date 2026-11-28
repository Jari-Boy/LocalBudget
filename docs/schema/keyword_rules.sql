-- keyword_rules のDDL(計画Issue #219)。ドメイン定義は docs/domain/counterparties.md 1.3、
-- 設計判断は docs/decisions/2026-11-16-06.md 2026-11-16 を参照
-- 摘要のキーワード(部分一致)から、取引先(任意)と相手科目(任意)を推定するルール。
-- 取引先は取引先マスタ、相手科目は勘定科目に紐づく。旧 counterparty_patterns の後継
CREATE TABLE keyword_rules (
  id               INTEGER PRIMARY KEY,
  pattern          TEXT NOT NULL,
  counterparty_id  INTEGER REFERENCES counterparties(id) ON DELETE CASCADE,
  -- 科目の削除時の扱いは、下の prepare_keyword_rules_on_account_delete トリガーで決める(決定16)
  account_id       INTEGER REFERENCES accounts(id),
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

-- 科目を物理削除するとき: 科目だけのルールはその科目と一緒に消し、取引先付きのルールは消さずに科目だけを外す
-- (取引先の推定を失わない。旧 counterparties.default_account_id の ON DELETE SET NULL と同じ考え方。計画Issue #219 決定16)。
-- 外部キー(account_id)は、このトリガーが先に片付けるので参照が残らない
CREATE TRIGGER prepare_keyword_rules_on_account_delete
BEFORE DELETE ON accounts
BEGIN
  DELETE FROM keyword_rules WHERE account_id = OLD.id AND counterparty_id IS NULL;
  UPDATE keyword_rules SET account_id = NULL WHERE account_id = OLD.id;
END;
