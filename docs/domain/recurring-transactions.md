# 定期取引ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、定期取引(RecurringTransactionRule)に関する詳細設計。

> **たたき台**
> 特に[1.2](#12-自動生成-vs-レビュー確認要議論)・[1.3](#13-繰り返しルールのスコープ)は方向性の確定が必要。

---

## 目次

1. [定期取引](#1-定期取引)
2. [定期取引マスタ(recurring_transaction_rules)](#2-定期取引マスタrecurring_transaction_rules)

---

## 1. 定期取引

### 1.1 位置づけ

家賃・サブスクリプション・給与など、毎月ほぼ同じ内容で繰り返される取引をテンプレート化する機能。テンプレート(`recurring_transaction_rules`)は仕訳のひな形を保持するのみで、実際の`journal_entries`は各サイクルごとに個別レコードとして生成される。生成後は独立した仕訳として扱われ、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り通常の仕訳と同様に編集・削除できる(締めを設けない設計との整合)。

### 1.2 自動生成 vs レビュー確認(要議論)

[architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)のCSVインポートは「レビュー画面を経由してから確定する」方針を取っている。定期取引も同じ思想を踏襲すべきか検討する。

| 案 | 概要 | 長所 | 短所 |
|---|---|---|---|
| A. レビュー必須 | 対象日になったら「提案」を作成し、ホーム画面等でユーザーに確認を促す。確認して初めて`journal_entries`が生成される | 金額が変動しうる定期取引(電気代等)でも誤記帳を防げる。CSVインポートと一貫した「入力経路によらずレビューを挟む」思想を維持できる | 家賃のように絶対に金額が変わらないものでも毎回ひと手間かかる |
| B. 自動確定を選択可能 | ルールごとに「自動確定」フラグを持たせ、有効なら対象日に`journal_entries`を即座に生成する | 手間が減る | 「ドメインの整合性ルールは入力経路で分岐しない」([architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)末尾)の精神とはやや矛盾する。過去の交通事例(サブスク料金の値上げ等)を取りこぼすリスクがある |

**本たたき台ではA案(レビュー必須)を採用**する。将来的にB案(自動確定オプション)を追加する場合も、A案の「提案生成」の仕組みの上に選択式で載せられるため、後方拡張は可能。

### 1.3 繰り返しルールのスコープ

MVPでは「毎月◯日」のみをサポートする。毎週・毎年・「第◯営業日」等の複雑なルールは将来課題とする。月末近辺の日付(31日等、存在しない月がある)を指定した場合の扱い(例: その月の末日に丸める)は実装時に確定する。

### 1.4 テンプレートの仕訳構成(スコープ)

複合仕訳(3行以上)のテンプレート化は複雑になるため、MVPでは「借方1科目・貸方1科目」の単純な2行仕訳のみを対象とする。プロジェクト・世帯メンバー・取引先は、[journal.md 2.1](./journal.md#21-フィールド定義)と同様の制約(PL科目の行にのみ設定可)に従い、テンプレートにも任意項目として持たせる。

### 1.5 生成された仕訳との関係

生成された`journal_entries`には生成元の`recurring_transaction_rule_id`を記録する(参照のみ)。ルールを後から変更しても、既に生成済みの過去の仕訳には影響しない。この参照は「どの定期取引から生まれた仕訳か」をUI上で辿れるようにするためのものであり、複式簿記の整合性検証には関与しない([accounts.md 1.3](./accounts.md#13-グルーピング表示用)の`account_groups`と同様、集計ロジックには影響しない付帯情報という位置づけ)。

### 1.6 ライフサイクル

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 生成済みの`journal_entries`が0件 | 可 |
| 物理削除 | 生成済みの`journal_entries`が1件以上 | 不可(非アクティブ化のみ) |
| 内容変更(金額・科目等) | 常に | 可。次回以降の提案生成にのみ反映され、過去生成分には影響しない |
| 非アクティブ化 | 任意(解約等) | 新規の提案生成を停止する。過去生成分の仕訳はそのまま残る |

---

## 2. 定期取引マスタ(recurring_transaction_rules)

### 2.1 フィールド定義

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ルールID | PK |
| `name` | ルール名 | 例:「家賃」「Netflix」 |
| `debit_account_id` | 借方科目 | FK |
| `credit_account_id` | 貸方科目 | FK |
| `amount` | 金額 | 通貨最小単位の正の整数。生成時のレビューで編集可能([1.2](#12-自動生成-vs-レビュー確認要議論)参照) |
| `day_of_month` | 実行日(毎月◯日) | 1〜31([1.3](#13-繰り返しルールのスコープ)参照) |
| `project_id` | プロジェクト | FK、任意。PL科目側の行にのみ意味を持つ([1.4](#14-テンプレートの仕訳構成スコープ)参照) |
| `household_member_id` | 世帯メンバー | FK、任意 |
| `counterparty_id` | 取引先 | FK、任意。PL科目側の行にのみ意味を持つ |
| `is_active` | 有効/非アクティブ | falseにすると新規の提案生成のみ停止する |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**journal_entriesへの追加フィールド**(既存テーブルへの変更、[journal.md](./journal.md)側への反映が別途必要)

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `generated_from_rule_id` | 生成元の定期取引ルール | FK、任意。手入力・CSVインポート由来の仕訳では`NULL`([1.5](#15-生成された仕訳との関係)参照) |

### 2.2 DDL

```sql
CREATE TABLE recurring_transaction_rules (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  debit_account_id      INTEGER NOT NULL REFERENCES accounts(id),
  credit_account_id     INTEGER NOT NULL REFERENCES accounts(id),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  day_of_month          INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  project_id            INTEGER REFERENCES projects(id),
  household_member_id   INTEGER REFERENCES household_members(id),
  counterparty_id       INTEGER REFERENCES counterparties(id),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 仕訳が紐づくルールの物理削除を禁止
CREATE TRIGGER prevent_delete_rule_with_journal_entries
BEFORE DELETE ON recurring_transaction_rules
WHEN EXISTS (
  SELECT 1 FROM journal_entries WHERE generated_from_rule_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete rule with generated journal entries');
END;

-- updated_at の自動更新
CREATE TRIGGER recurring_transaction_rules_set_updated_at
AFTER UPDATE ON recurring_transaction_rules
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE recurring_transaction_rules SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- journal_entries への追加(journal.md 2.2 DDL側への反映が必要)
ALTER TABLE journal_entries
  ADD COLUMN generated_from_rule_id INTEGER
    REFERENCES recurring_transaction_rules(id);
```

### 2.3 他ドメインへの影響

`journal_entries`に`generated_from_rule_id`カラムの追加が必要(上記DDL参照)。方向性が固まり次第、[journal.md 2章](./journal.md#2-仕訳マスタjournal_entriesjournal_lines)に反映する。
