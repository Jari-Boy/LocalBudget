# 予算ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、予算(Budget)に関する詳細設計。

> **たたき台**
> 他ドメインと異なり、まだユーザーレビュー前の初稿。特に[1.2](#12-対象単位要議論)・[1.3](#13-繰り返し方式要議論)は複数案を併記しており、方向性の確定が必要。

---

## 目次

1. [予算](#1-予算)
2. [予算マスタ(budgets)](#2-予算マスタbudgets)

---

## 1. 予算

### 1.1 位置づけ

予算は「勘定科目ごとに、ある期間いくらまで使ってよいか」の上限額を表す。プロジェクト・世帯メンバー・取引先のように仕訳明細(JournalLine)へタグ付けする軸ではなく、勘定科目(用途)に対して設定する目標値であり、実績との比較はFSと同様に都度計算する([1.4](#14-集計への影響)参照)。

### 1.2 対象単位(要議論)

- **対象科目**: `expense`区分の科目のみを対象とする。`revenue`区分への「収入目標」設定は将来課題とし、MVPではスコープ外とする。
- **勘定科目 vs account_groups**: MVPでは個々の`accounts`単位のみを予算設定の対象とし、[accounts.md 1.3](./accounts.md#13-グルーピング表示用)の`account_groups`単位での予算(例:「水道光熱費グループ全体で1万円」)は対象外とする。
  > **なぜグループ予算を見送るか**
  > 科目単位とグループ単位の予算を両方許可すると、ある科目が両方の予算に同時にカウントされる二重計上、あるいは「グループ予算と科目予算のどちらを見ればよいか」というUI上の優先順位の問題が生じる。`account_groups`は[accounts.md 1.3](./accounts.md#13-グルーピング表示用)の通りFS集計に一切影響しない「表示用の分類」と位置づけており、予算という実質的な集計ロジックに関与させると、その原則が崩れる。グループ予算が必要になった場合は、二重計上回避のルールも含めて再設計する。

### 1.3 繰り返し方式(要議論)

「毎月の食費予算3万円」のように、多くの予算は月が変わっても同じ額を使い回したいというニーズがある。以下の2案を検討する。

| 案 | 概要 | 長所 | 短所 |
|---|---|---|---|
| A. 年月ごとに都度レコード | `(account_id, year_month, amount)`の単純な行を月ごとに作る。UI側で「先月の内容をコピー」ボタンを提供 | データモデルがシンプル、過去の予算改定履歴が自然に残る | 月初にレコードを作る一手間が必要(UIで緩和) |
| B. 有効開始年月+継続適用 | `(account_id, effective_from_year_month, amount)`とし、次の変更があるまで継続適用とみなす | レコード数が少ない | 「ある年月時点で有効な予算額」を求めるクエリが複雑化する(直近の`effective_from`を探索する必要がある) |

**本たたき台ではA案を採用**する。ローカルSQLiteでは行数増加のコストは無視できる規模であり、[1.1 基本方針](../domain.md#11-基本方針)や他ドメイン([financial-statements.md](./financial-statements.md)等)が一貫して採用している「都度計算・素直なデータモデル優先」の方針とも合う。

### 1.4 集計への影響

期間PL実績([financial-statements.md 2章](./financial-statements.md#2-財務諸表fs))と組み合わせて、予算比を算出する。

```
予算残額(account_id, year_month) =
  budgets.amount
  - Σ(amount WHERE side = 'debit') + Σ(amount WHERE side = 'credit')
    (journal_lines.account_id = 対象科目、entry_date が year_month の範囲内)
```

期間は「月」固定とする(予算の粒度自体を月以外にする話は将来課題)。

### 1.5 ライフサイクル

予算は他のマスタから参照される軸ではなく(仕訳明細から直接参照されない)、勘定科目・プロジェクト等のような「紐づく仕訳があるから削除できない」という制約は不要。

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 常に | 可 |
| 金額変更 | 常に | 可 |

---

## 2. 予算マスタ(budgets)

### 2.1 フィールド定義

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 予算ID | PK |
| `account_id` | 対象勘定科目 | FK、`expense`区分のみ許可(TRIGGERで強制、[1.2](#12-対象単位要議論)参照) |
| `year_month` | 対象年月 | `YYYY-MM` |
| `amount` | 予算額 | 通貨最小単位の整数、0以上 |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

同一科目・同一年月の予算は1件のみ(ユニーク制約)。

### 2.2 DDL

```sql
CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  year_month  TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (account_id, year_month)
);

CREATE INDEX idx_budgets_year_month ON budgets(year_month);

-- 予算はexpense区分の科目にのみ設定可能
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装。journal.mdのproject_id/counterparty_id制約と同じ理由)
CREATE TRIGGER prevent_budget_on_non_expense_insert
BEFORE INSERT ON budgets
WHEN (SELECT category FROM accounts WHERE id = NEW.account_id) != 'expense'
BEGIN
  SELECT RAISE(ABORT, 'budgets can only be set on expense accounts');
END;

CREATE TRIGGER prevent_budget_on_non_expense_update
BEFORE UPDATE ON budgets
WHEN (SELECT category FROM accounts WHERE id = NEW.account_id) != 'expense'
BEGIN
  SELECT RAISE(ABORT, 'budgets can only be set on expense accounts');
END;

-- updated_at の自動更新
CREATE TRIGGER budgets_set_updated_at
AFTER UPDATE ON budgets
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE budgets SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

### 2.3 他ドメインへの影響

既存テーブル(`accounts`・`journal_entries`・`journal_lines`)へのカラム追加は不要。`budgets`は独立した新規テーブルのみで完結する。
