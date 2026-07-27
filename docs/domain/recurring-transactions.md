# 定期取引ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、定期取引(RecurringTransactionRule)に関する詳細設計。

---

## 目次

1. [定期取引](#1-定期取引)
2. [定期取引マスタ(recurring_transaction_rules)](#2-定期取引マスタrecurring_transaction_rules)

---

## 1. 定期取引

### 1.1 位置づけ

家賃・サブスクリプション・給与など、毎月ほぼ同じ内容で繰り返される取引をテンプレート化する機能。テンプレート(`recurring_transaction_rules`)は仕訳のひな形を保持するのみで、実際の`journal_entries`は各サイクルごとに個別レコードとして生成される。生成後は独立した仕訳として扱われ、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り通常の仕訳と同様に編集・削除できる(締めを設けない設計との整合)。

> **is_reconcilable科目を直接の`debit_account_id`/`credit_account_id`にはできない**
> [reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産負債への直接記帳の制限)の通り、`is_reconcilable = true`の科目(銀行口座等、およびクレジットカードのカード専用未払金)を使う仕訳はCSVインポート由来に限られ、定期取引による生成(レビュー確認を経ても)はこれに該当しない。したがって家賃・給与のように口座が絡む定期取引は、口座科目を直接使わず未払金・未収金を経由して暫定計上するテンプレートとして組む([reconciliation.md 1.4](./reconciliation.md#14-暫定記帳未払金未収金と消込)の例、[journal.md 1.2](./journal.md#12-記帳の型具体例)参照)。CSV到着後の消込自体は突合ドメイン側([reconciliation.md 1.6 重複防止フロー](./reconciliation.md#16-重複防止フロー))で行われ、定期取引の生成物ではない。

### 1.2 自動生成 vs レビュー確認

[architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)のCSVインポートは「レビュー画面を経由してから確定する」方針を取っている。定期取引も同じ思想を踏襲し、対象日になったら「提案」を作成してホーム画面等でユーザーに確認を促し、確認して初めて`journal_entries`が生成される方式とする。

> **なぜ自動確定オプションを設けないか**
> ルールごとに「自動確定」フラグを持たせ即座に`journal_entries`を生成する案も検討したが、「ドメインの整合性ルールは入力経路で分岐しない」([architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)末尾)の精神とはやや矛盾するうえ、サブスク料金の値上げのような金額変動を取りこぼすリスクがある。レビュー確認方式に統一する。将来的に自動確定オプションを追加する場合も、この「提案生成」の仕組みの上に選択式で載せられるため、後方拡張は可能。

> **なぜ将来分をまとめて事前生成しないか**
> 定期取引には終了日がなく、将来分を事前生成するにしても「向こう1年分」のようにどこかで打ち切る必要があり、期限が近づけば結局追加生成が要る。生成の粒度が変わるだけで「都度生成」自体はなくならないうえ、[1.1](#11-位置づけ)の通り口座科目を直接使えない制約から恩恵も限定的、かつ将来分を今の金額でまとめて確定すると値上げ等をレビューなしで取りこぼす。[architecture.md](../architecture.md)の通りサーバーを持たないローカルファーストアプリであるため、そもそも「対象日になったら」を実現するcron相当の仕組みは存在しない。**アプリ起動時に、前回チェック日から現在までの間で発生すべき対象日をまとめて遅延評価し、提案を生成する**実装とする。専用のバッチ処理を別途持つ必要がなく、生成タイミングは「起動時」に一本化される。

### 1.3 繰り返しルールの表現方式

家賃(毎月1日)・給与(毎月25日)だけでなく、「毎週月曜日」「第2土曜日」のような曜日ベースの繰り返しにも対応する。`frequency`(`weekly`/`monthly`/`yearly`)を起点に、繰り返しの種類に応じて必要なカラムのみを埋める列挙型で表現する([2.1](#21-フィールド定義)参照)。

| frequency | 使うカラム | 例 |
|---|---|---|
| `weekly` | `day_of_week` | 毎週月曜日 |
| `monthly`(日付指定) | `day_of_month` | 毎月25日(給与) |
| `monthly`(曜日指定) | `week_of_month` + `day_of_week` | 第2土曜日 |
| `yearly` | `month_of_year` + `day_of_month` | 毎年6月1日(保険料) |

> **なぜRRULE(iCalendar形式)を採用しないか**
> RFC 5545のRRULE文字列をそのまま保存し`rrule.js`等の外部ライブラリで次回発生日を計算する案も検討したが、表現力に対して実装コストが見合わない。家計簿の定期取引は「月◯日」「毎週◯曜日」「第◯何曜日」「年◯月◯日」の組み合わせでほぼ尽くせるため、列挙型カラムで素直に表現し、外部ライブラリへの依存([architecture.md 11章](../architecture.md#11-セキュリティプライバシー方針)のサプライチェーンリスク方針)を増やさない。
>
> **「月2回」の扱い**: 1ルールにつき1つの発生パターンのみを許可する(単一ルールでの複数日付指定はサポートしない)。「15日と月末に半分ずつ家賃を払う」のような月2回パターンは、`day_of_month = 15`のルールと`day_of_month = 末日`のルールを2件登録することで表現する。データモデルを単純に保つためのトレードオフ。
>
> 月末近辺の日付(31日等、存在しない月がある)を指定した場合の扱い(例: その月の末日に丸める)は実装時に確定する。

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
| `name` | ルール名 | 例:「家賃」「Netflix」「お小遣い(第2土曜日)」 |
| `debit_account_id` | 借方科目 | FK。`asset`区分かつ`is_reconcilable = true`の科目は指定不可([1.1](#11-位置づけ)参照) |
| `credit_account_id` | 貸方科目 | FK。同上 |
| `amount` | 金額 | 通貨最小単位の正の整数。生成時のレビューで編集可能([1.2](#12-自動生成-vs-レビュー確認)参照) |
| `frequency` | 繰り返し種別 | ENUM: `weekly`/`monthly`/`yearly`([1.3](#13-繰り返しルールの表現方式)参照) |
| `day_of_week` | 曜日 | 0(日)〜6(土)、任意。`weekly`、または`monthly`の「第◯何曜日」指定で使用 |
| `day_of_month` | 日 | 1〜31、任意。`monthly`の「◯日」指定、または`yearly`で使用 |
| `week_of_month` | 第◯週 | 1〜5または-1(最終週)、任意。`monthly`の「第◯何曜日」指定でのみ使用 |
| `month_of_year` | 月 | 1〜12、任意。`yearly`でのみ使用 |
| `project_id` | プロジェクト | FK、任意。PL科目側の行にのみ意味を持つ([1.4](#14-テンプレートの仕訳構成スコープ)参照) |
| `household_member_id` | 世帯メンバー | FK、任意 |
| `counterparty_id` | 取引先 | FK、任意。PL科目側の行にのみ意味を持つ |
| `is_active` | 有効/非アクティブ | falseにすると新規の提案生成のみ停止する |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

`frequency`ごとに使用するカラムの組み合わせは[1.3](#13-繰り返しルールの表現方式)の表の通りで、それ以外のカラムは`NULL`にする(DDLのCHECK制約で強制、[2.2](#22-ddl)参照)。

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
  frequency             TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  day_of_week           INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month          INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  week_of_month         INTEGER CHECK (week_of_month BETWEEN -1 AND 5 AND week_of_month != 0),
  month_of_year         INTEGER CHECK (month_of_year BETWEEN 1 AND 12),
  project_id            INTEGER REFERENCES projects(id),
  household_member_id   INTEGER REFERENCES household_members(id),
  counterparty_id       INTEGER REFERENCES counterparties(id),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  -- frequencyごとに使用するカラムの組み合わせを強制する(1.3の対応表参照)
  CHECK (
    (frequency = 'weekly'
      AND day_of_week IS NOT NULL
      AND day_of_month IS NULL AND week_of_month IS NULL AND month_of_year IS NULL)
    OR
    (frequency = 'monthly' AND month_of_year IS NULL
      AND (
        (day_of_month IS NOT NULL AND day_of_week IS NULL AND week_of_month IS NULL)
        OR
        (day_of_week IS NOT NULL AND week_of_month IS NOT NULL AND day_of_month IS NULL)
      ))
    OR
    (frequency = 'yearly'
      AND month_of_year IS NOT NULL AND day_of_month IS NOT NULL
      AND day_of_week IS NULL AND week_of_month IS NULL)
  )
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
