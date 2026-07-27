# 仕訳ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、仕訳(JournalEntry)・仕訳明細(JournalLine)に関する詳細設計。

---

## 目次

1. [仕訳ドメイン](#1-仕訳ドメイン)
2. [仕訳マスタ(journal_entries・journal_lines)](#2-仕訳マスタjournal_entriesjournal_lines)

---

## 1. 仕訳ドメイン

### 1.1 仕訳(JournalEntry)と仕訳明細(JournalLine)

取引は「仕訳(JournalEntry)」という単位で記録される。仕訳は日付・摘要を持つヘッダーであり、実際の金額の増減は子レコードである「仕訳明細(JournalLine)」に記録される。1つの仕訳は2件以上の仕訳明細から成り、その合計金額は借方・貸方で必ず一致する(複式簿記の恒等式)。仕訳明細は勘定科目に加えて、任意でプロジェクト([projects.md 1章](./projects.md#1-プロジェクト))・世帯メンバー([household-members.md 1章](./household-members.md#1-世帯メンバー))を紐づけられる。

| 概念           | 役割                                         | 例                          |
| ------------ | ------------------------------------------ | -------------------------- |
| JournalEntry | 1つの取引のヘッダー。日付・摘要                           | 「2026-07-20 スーパーで食材購入」     |
| JournalLine  | 仕訳を構成する各行。勘定科目・金額・借方/貸方・(任意で)プロジェクト・世帯メンバー | 「(借)食費 3,000」「(貸)現金 3,000」 |

最もシンプルな仕訳は2行(借方1行・貸方1行)。1つの支払いを複数の費目にまたがって計上する複合仕訳では3行以上になる。

```
例: 1万円をカードで買い物し、食費7,000円・日用品費3,000円に分けて計上する

(借) 費用・食費        7,000
(借) 費用・日用品費    3,000
(貸) 負債・未払金             10,000
```

仕訳明細の借方/貸方は、金額を表す`amount`(常に正の整数)と、借方/貸方を表す`side`(`debit`/`credit`)の2列で表現する。1行=1エントリとして扱えるため、口座残高やFSの集計クエリを「`side`に応じて符号を反転して合算する」という単一のロジックで一貫して書ける(詳細は[financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式))。

### 1.2 記帳の型(具体例)

```
食費を現金で払う      : (借) 費用・食費      / (貸) 資産・現金
給与が振り込まれる    : (借) 資産・普通預金  / (貸) 収益・給与収入
投信を買う            : (借) 資産・証券口座  / (貸) 資産・普通預金   ← PL影響なし
カードで買い物        : (借) 費用            / (貸) 負債・未払金
  後日引き落とし      : (借) 負債・未払金    / (貸) 資産・普通預金
給与を先に見込み計上  : (借) 資産・未収金    / (貸) 収益・給与収入
  後日振込(消込)      : (借) 資産・普通預金  / (貸) 資産・未収金
```

> **is_reconcilable資産への記帳経路の制約**
> 「普通預金」のような`is_reconcilable = true`の資産科目を直接使う仕訳は、[reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産への直接記帳の制限)の通りCSVインポート由来の仕訳(+口座開設時の初期残高仕訳)に限られる。「給与が振り込まれる」の例はCSV到着時にその場で記帳するケースを表す。CSV到着前に先に記帳したい場合は「給与を先に見込み計上」のように未収金・未払金を経由した暫定計上を行い、CSV到着後にそれを消し込む([reconciliation.md 1.4](./reconciliation.md#14-暫定記帳未払金未収金と消込)参照)。

### 1.3 貸借バランスの検証

1つの仕訳(JournalEntry)に属する仕訳明細(JournalLine)は、借方合計と貸方合計が常に一致しなければならない。

```
Σ(amount WHERE side = 'debit')  ==  Σ(amount WHERE side = 'credit')
  (同一 journal_entry_id 内)
```

**検証はRepository層(アプリケーションコード)で行う。** SQLiteのTRIGGERは行単位(`FOR EACH ROW`)で即時発火するため、仕訳明細を1行ずつINSERTする通常のフローでは「1行目を書き込んだ時点では借方だけで貸方がまだ無い」という中間状態を経由する。この中間状態でトリガーが借方・貸方の不一致を検出して即ABORTしてしまうため、複数行にまたがる集約制約をDBトリガーで実用的に強制することはできない。

そのため、`JournalEntryRepository`が仕訳を作成・更新する際に、ヘッダーと全ての明細行をまとめて構築し、ひとつのDBトランザクションに書き込む直前にアプリケーションコードとして借方合計・貸方合計の一致を検証する。不一致であれば書き込みを行わず、ドメインエラー(例: `UnbalancedJournalEntryError`)を返す。DB側は単一行として成立しない異常値(`amount <= 0`等)のみCHECK制約で弾き、行をまたぐ整合性はDBに委ねない。

マニュアル起票・CSVインポートいずれの経路でも、最終的にこの`JournalEntryRepository`を経由するため、入力経路によって整合性ルールが分岐することはない([architecture.md](../architecture.md) 12章の方針と一致)。

### 1.4 金額と通貨

- 金額は通貨の最小単位(日本円なら1円単位)の整数値として保持する([architecture.md](../architecture.md) 13章の方針を踏襲)。浮動小数点は用いない。
- 通貨コードはISO 4217に準拠し、`journal_entries`にヘッダー単位で持たせる。1つの取引(仕訳)内で複数通貨が混在するケースは想定しないため、明細ではなくヘッダーの属性とする。
- MVPでは日本円(`JPY`)固定で扱う。実際の多通貨レート換算ロジックは将来課題でありスコープ外。

### 1.5 仕訳の編集・削除

- [financial-statements.md 1章 期間確定と締め](./financial-statements.md#1-期間確定と締め)の方針により、過去の仕訳の編集・削除は常に可能とする。ロックは設けない。
- 明細行を編集する場合も、保存前に[1.3](#13-貸借バランスの検証)のバランス検証を通す。
- 編集のたびに`journal_entries.updated_at`を更新する(明細行自体は`updated_at`を持たない。[accounts.md 3.1 フィールド定義](./accounts.md#31-フィールド定義)参照)。

### 1.6 CSVインポートとの関係

CSVインポート時の相手勘定科目の自動推定は、取引先マスタを介したサジェスト機能として[counterparties.md 1章](./counterparties.md#1-取引先)で定義する。本章で定義した仕訳・仕訳明細のデータモデルと貸借バランス検証は、CSVインポート経由・マニュアル起票経由のいずれからも共通して使われる土台として位置づける([architecture.md](../architecture.md) 12章の方針の通り)。

---

## 2. 仕訳マスタ(journal_entries・journal_lines)

### 2.1 フィールド定義

**journal_entries**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 仕訳ID | PK |
| `entry_date` | 取引日 | `YYYY-MM-DD` |
| `memo` | 摘要 | 任意 |
| `currency` | 通貨コード | ISO 4217、MVPでは`JPY`固定 |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**journal_lines**

| カラム                   | 内容            | 制約・備考                                                                           |
| --------------------- | ------------- | ------------------------------------------------------------------------------- |
| `id`                  | 明細ID          | PK                                                                              |
| `journal_entry_id`    | 親仕訳ID         | FK、親削除時はCASCADE                                                                 |
| `account_id`          | 勘定科目ID        | FK                                                                              |
| `project_id`          | プロジェクトID      | FK、任意。PL科目(revenue/expense)の行にのみ設定可(TRIGGERで強制、[projects.md 1.2](./projects.md#12-紐づけ対象)参照)              |
| `household_member_id` | 世帯メンバーID(上書き) | FK、任意。全区分で設定可。NULL=`accounts.household_member_id`を継承([household-members.md 1.2](./household-members.md#12-紐づけ対象と既定値の継承)参照) |
| `counterparty_id`     | 取引先ID         | FK、任意。PL科目(revenue/expense)の行にのみ設定可(TRIGGERで強制、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)参照)              |
| `side`                | 借方/貸方         | ENUM: debit/credit                                                              |
| `amount`              | 金額            | 通貨最小単位の正の整数                                                                     |
| `created_at`          | 作成日時          |                                                                                 |

> 明細行自体には`updated_at`を持たせない。明細の変更は「仕訳ヘッダー配下の行構成をまるごと差し替える」操作としてRepository層が扱い、変更の痕跡は親である`journal_entries.updated_at`側に集約する([1.5](#15-仕訳の編集削除)参照)。

### 2.2 DDL

```sql
CREATE TABLE journal_entries (
  id           INTEGER PRIMARY KEY,
  entry_date   TEXT NOT NULL,
  memo         TEXT,
  currency     TEXT NOT NULL DEFAULT 'JPY',
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
```

> **貸借バランスはDBで強制しない**
> [1.3](#13-貸借バランスの検証)の通り、SQLiteのTRIGGERは行単位で即時発火するため、「1仕訳内で借方合計=貸方合計」という複数行にまたがる制約を実用的に強制できない。この検証は`JournalEntryRepository`が担う。
