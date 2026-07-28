-- household_members / household_member_group_memberships のDDL
-- ドメイン定義・各制約の設計判断は docs/domain/household-members.md を参照

CREATE TABLE household_members (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  is_group    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE household_member_group_memberships (
  group_id   INTEGER NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, member_id)
);

-- group_id は is_group=TRUE のレコードのみ許可
-- member_id は is_group=FALSE のレコードのみ許可(グループのネスト禁止)
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装。実機検証済み: household-members.md 1.5参照)
CREATE TRIGGER check_group_membership_group_insert
BEFORE INSERT ON household_member_group_memberships
WHEN (SELECT is_group FROM household_members WHERE id = NEW.group_id) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'group_id must reference a group (is_group = TRUE)');
END;

CREATE TRIGGER check_group_membership_member_insert
BEFORE INSERT ON household_member_group_memberships
WHEN (SELECT is_group FROM household_members WHERE id = NEW.member_id) IS NOT FALSE
BEGIN
  SELECT RAISE(ABORT, 'member_id must reference an individual (is_group = FALSE); nesting groups is not allowed');
END;

-- is_group の変更を禁止
CREATE TRIGGER prevent_is_group_change
BEFORE UPDATE OF is_group ON household_members
WHEN OLD.is_group != NEW.is_group
BEGIN
  SELECT RAISE(ABORT, 'is_group cannot be changed');
END;

-- 勘定科目・仕訳明細が紐づくメンバー/グループの物理削除を禁止
CREATE TRIGGER prevent_delete_member_with_references
BEFORE DELETE ON household_members
WHEN EXISTS (SELECT 1 FROM accounts WHERE household_member_id = OLD.id)
  OR EXISTS (SELECT 1 FROM journal_lines WHERE household_member_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete household member with references');
END;

-- updated_at の自動更新
CREATE TRIGGER household_members_set_updated_at
AFTER UPDATE ON household_members
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE household_members SET updated_at = datetime('now') WHERE id = NEW.id;
END;
