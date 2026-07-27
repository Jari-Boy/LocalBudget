# プロジェクトドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、プロジェクト(Project)に関する詳細設計。

---

## 目次

1. [プロジェクト](#1-プロジェクト)
2. [プロジェクトマスタ(projects)](#2-プロジェクトマスタprojects)

---

## 1. プロジェクト

### 1.1 位置づけ

プロジェクトは「何の目的で使ったお金か」を表す軸であり、勘定科目(用途)・取引先(支払先)とは直交する。[domain.md 1.1](../domain.md#11-基本方針)の方針の通り、勘定科目の階層に混ぜ込まず、独立したエンティティとして持つ。

「26年7月アメリカ旅行」のように期間や目的が明確な催しに紐づく支出を横断的に集計したい、という要求に応える機能。勘定科目を細分化する(例:「旅行用食費」を新設する)のではなく、既存の勘定科目(食費・交通費など)はそのまま使い、プロジェクトというタグで横串を刺す。

### 1.2 紐づけ対象

プロジェクトは仕訳明細(JournalLine)単位で紐づける。1つの仕訳(複合仕訳)の中でも、行ごとに異なるプロジェクトを設定できる。

```
例: 1回のカード決済でお土産(旅行用)とスーツケース(日用品)を同時に購入

(借) 費用・お土産代    5,000   project = 26年7月アメリカ旅行
(借) 費用・日用品費    3,000   project = (なし)
(貸) 負債・未払金             8,000
```

プロジェクトは **PL科目(収益・費用)の行にのみ** 設定可能とする。資産・負債・純資産の行(口座残高側)には設定できない。口座残高の管理軸(BS)と、支出目的の分析軸(プロジェクト)を独立させるための制約。

> **なぜCHECK制約ではなくTRIGGERで強制するか**
> 「PL科目の行にのみ`project_id`を許可する」制約は、`journal_lines.account_id`から`accounts.category`を参照して判定する必要がある。SQLiteのCHECK制約はサブクエリを許可しないため(実機検証済み: `subqueries prohibited in CHECK constraints`)、この制約はCHECK制約では書けない。そのためBEFORE INSERT/UPDATEのTRIGGERで実装する([journal.md 2.2 DDL](./journal.md#22-ddl)参照)。

### 1.3 ライフサイクル

プロジェクトは勘定科目と同様、削除ではなく非アクティブ化を基本とする。

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 紐づく仕訳明細が0件 | 可 |
| 物理削除 | 紐づく仕訳明細が1件以上 | 不可(非アクティブ化のみ) |
| 名称変更 | 常に | 可 |
| 非アクティブ化 | 任意(例: 旅行が終わった) | 過去集計はそのまま表示、新規仕訳では選択不可 |

勘定科目における`category`(区分)や`is_system_managed`に相当する概念は持たない。プロジェクトはすべてユーザー定義であり、システムが特別扱いするプロジェクトは存在しない。

### 1.4 集計への影響

[financial-statements.md 2章 財務諸表(FS)](./financial-statements.md#2-財務諸表fs)の期間集計とは独立した軸として、「プロジェクト別の支出合計」を提供する。

```
プロジェクト別費用合計 =
  Σ(amount WHERE side = 'debit') - Σ(amount WHERE side = 'credit')
  (project_id = 対象プロジェクト、期間で絞らず全期間が既定)
```

期間PL([financial-statements.md 2章](./financial-statements.md#2-財務諸表fs))は「特定の期間の全支出」、プロジェクト別集計は「特定の目的の全支出(期間不問が既定)」であり、互いに独立した2つの切り口として併存する。両方を同時に絞り込む(例:「今月のアメリカ旅行費用」)ことも、期間条件とproject_id条件を組み合わせるだけで自然に実現できる。

---

## 2. プロジェクトマスタ(projects)

### 2.1 フィールド定義

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | プロジェクトID | PK |
| `name` | プロジェクト名 | 例:「26年7月アメリカ旅行」、自由記述 |
| `is_active` | 有効/非アクティブ | falseにしても過去仕訳・過去集計に影響なし |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

勘定科目マスタと異なり、`category`(区分)・`is_reconcilable`・`is_system_managed`に相当するフィールドは持たない。すべてのプロジェクトはユーザー定義かつ対等であり、システムが特別扱いするものはない([1.3](#13-ライフサイクル)参照)。

### 2.2 DDL

```sql
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 仕訳明細が紐づくプロジェクトの物理削除を禁止
CREATE TRIGGER prevent_delete_project_with_journal_lines
BEFORE DELETE ON projects
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE project_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete project with journal lines');
END;

-- updated_at の自動更新
CREATE TRIGGER projects_set_updated_at
AFTER UPDATE ON projects
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```
