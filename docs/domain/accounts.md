# 勘定科目ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、勘定科目(Account)に関する詳細設計。体系・ライフサイクル・マスタ(accounts / account_groups)・口座登録UXを扱う。

---

## 目次

1. [勘定科目体系](#1-勘定科目体系)
2. [勘定科目のライフサイクル](#2-勘定科目のライフサイクル)
3. [勘定科目マスタ(accounts)](#3-勘定科目マスタaccounts)
4. [口座登録のUX](#4-口座登録のux)

---

## 1. 勘定科目体系

### 1.1 二層構造

勘定科目体系は「区分」と「勘定科目」の二層で構成される。

| 層 | 内容 | 個数 | 決定主体 |
|---|---|---|---|
| 区分 | 資産/負債/純資産/収益/費用 | 5(固定) | システム側で固定 |
| 勘定科目 | 個々の口座・費目など | 無制限 | ユーザーが自由に追加 |

> **個数の扱い**
> 体系(マスタ設計)には勘定科目数の上限を設けない。口座数や費目数はユーザーごとに必要数が異なるため、初期表示件数の絞り込みはUXの領域であり、体系の制約とは別に扱う。

### 1.2 区分(5要素)

区分は複式簿記の5要素で固定し、変更手段はUIにもAPIにも用意しない。

| 区分 | コード | 所属 | 勘定科目の例 |
|---|---|---|---|
| 資産 | `asset` | BS | 現金/普通預金/定期預金/電子マネー/証券口座/未収金(一時勘定) |
| 負債 | `liability` | BS | クレジットカード未払金/未払金(一時勘定)/ローン/立替金 |
| 純資産 | `equity` | BS | 初期残高(口座ごと、システム管理) |
| 収益 | `revenue` | PL | 給与収入/副業収入/謝礼収入 |
| 費用 | `expense` | PL | 食費/住居費/水道光熱費/娯楽費/現金過不足(システム管理) … |

> **資産振替は費用ではない**
> 貯蓄・投資は現金という資産が別の資産へ形を変える、資産→資産の振替であり、費用ではない。PLには影響しない。

> **「未収金」はis_reconcilable = falseで登録する**
> [reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産への直接記帳の制限)の通り、`asset`区分かつ`is_reconcilable = true`の科目はCSVインポート由来の仕訳からしか使えない。「未収金」は給与等をCSV到着前に暫定計上するための一時勘定であり、CSVと直接照合される本物の口座ではないため、口座登録ウィザード([4章](#4-口座登録のux))ではなく通常の勘定科目追加で`is_reconcilable = false`として作成する([reconciliation.md 1.4](./reconciliation.md#14-暫定記帳未払金未収金と消込)参照)。`is_reconcilable = true`にしてしまうと未収金自体への暫定計上ができなくなり本末転倒になる。

> **純資産(equity)区分はユーザーが科目を追加できない**
> 資本科目間の振替(決算振替仕訳等)は一般ユーザー向け家計簿では実質発生しないため、`equity`区分はシステムが生成する科目(口座ごとの初期残高科目、[3.1](#31-フィールド定義)参照)のみが存在し、ユーザーによる新規作成を許可しない([3.2 DDL](#32-ddl)のトリガーで強制)。ユーザーが編集できるのは既存のsystem-managed科目の`name`(ラベル)のみである。
>
> なお「繰越利益」は科目としては存在しない。[financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式)の通り、決算振替仕訳を行わない設計であるため、当期純利益相当額(収益−費用)は常にFS生成時の計算値として求められ、`accounts`にレコードとして計上されることはない。

### 1.3 グルーピング(表示用)

勘定科目の数が増えると、似た用途の科目(例:水道代・ガス料金・電気代)をまとめて見たいという要求が出てくる。この要求は勘定科目自体の階層化(親子構造)ではなく、`account_groups`という独立した分類ラベルへの紐付けで解決する([3.3](#33-勘定科目グループマスタaccount_groups)参照)。

- グループはあくまで表示上の分類であり、[financial-statements.md 2章](./financial-statements.md#2-財務諸表fs)の集計ロジック・仕訳の[journal.md 1.3 貸借バランスの検証](./journal.md#13-貸借バランスの検証)には一切影響しない。
- 1科目は0または1個のグループにのみ属する(単一所属)。複数グループへの同時所属は許可しない。
  > **なぜ単一所属か**
  > 科目が複数グループに属せると、将来「グループ別合計」を提供する際に同じ科目の金額が複数グループの合計に二重計上され、「全グループの合計 = 全科目の合計」という直感的な性質が崩れる。[household-members.md 1.5 グループ(複数メンバーの集合)](./household-members.md#15-グループ複数メンバーの集合)の世帯メンバーグループは個人の多重所属を許可しつつ「グループを独立した集計単位として扱う」ことで二重計上を回避しているが、勘定科目グループは単純なフォルダ分けとして使うため、同種の複雑な回避策を導入するより単一所属に制限する方が設計として素直である。
- 勘定科目の階層化(親子関係)は採用しない。階層は[financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式)のロールアップ計算や、[2章 勘定科目のライフサイクル](#2-勘定科目のライフサイクル)の親子間での伝播ルール(非アクティブ化・削除等)を新たに必要とし、複式簿記のコアロジックを不必要に複雑化するため。
- グループ自体は`projects`・`counterparties`と同様、`category`や`is_system_managed`に相当する概念を持たない、対等なユーザー定義ラベルである。

---

## 2. 勘定科目のライフサイクル

削除可否・変更可否は「仕訳と紐づいているかどうか」という単一の基準で判定される。

### 2.1 操作ルール

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 紐づく仕訳が0件 | 可 |
| 物理削除 | 紐づく仕訳が1件以上 | 不可(非アクティブ化のみ) |
| ラベル(表示名)変更 | 同一区分内 | 常に可 |
| 区分またぎ変更 | 常に | 不可(ラベルが中身か) |
| 別科目への実質変更 | 別科目にする | 反対仕訳で持ち消し、新科目で計上 |
| 非アクティブ化 | 任意 | 過去集計はそのまま表示、新規仕訳では選択不可 |

### 2.2 過去仕訳の付け替え

科目を分割・変更する場合(例:「食費」→「食費」と「外食費」)、過去分を新科目へ一括付け替えできる(反対仕訳+新科目での再計上)。FSは仕訳から都度生成されるため、付け替えても次の集計で自動反映される。FS側の特別対応は不要。

### 2.3 非アクティブ化

- 解約した口座・使わなくなった費目は削除ではなく非アクティブ化する。
- 過去のFS・集計では従来どおり表示され、履歴の連続性が保たれる。
- 新規仕訳の科目選択肢からは除外される。

---

## 3. 勘定科目マスタ(accounts)

### 3.1 フィールド定義

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 科目ID | PK |
| `category` | 区分 | ENUM: asset/liability/equity/revenue/expense、変更不可 |
| `name` | 勘定科目名 | 同一区分内であればいつでも変更可 |
| `is_reconcilable` | 照合可否 | 資産科目は`NOT NULL`、他区分は`NULL`必須(CHECK制約で強制) |
| `is_active` | 有効/非アクティブ | falseにしても過去仕訳・過去FSに影響なし |
| `is_system_managed` | システム管理科目か | 口座ごとの初期残高科目・現金過不足など、削除・区分変更・非アクティブ化を禁止。`name`(ラベル)変更のみ可 |
| `household_member_id` | 既定の名義 | FK、任意。NULL=世帯共通([household-members.md 1.2](./household-members.md#12-紐づけ対象と既定値の継承)参照) |
| `account_group_id` | 表示用グループ | FK、任意。0または1個のグループに属する(単一所属、[1.3](#13-グルーピング表示用)参照)。NULL=未分類 |
| `initial_balance_for_account_id` | 初期残高科目の対象口座 | FK(自己参照)、任意。この科目が特定の資産科目専用の初期残高科目(`category = 'equity'`かつ`is_system_managed = true`)である場合のみ値を持つ([4.3 初期残高の自動仕訳](#43-初期残高の自動仕訳)参照)。通常の科目では`NULL` |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | `name`/`is_active`等の変更のたびに更新する。将来のマルチデバイス同期([architecture.md](../architecture.md) 5章)の布石 |

> **補足**
> `has_journal_lines`(仕訳紐付け)は物理カラムを持たず、`EXISTS`判定で都度算出する(性能上の必要が出る段階でキャッシュ化)。

> **なぜ口座ごとに初期残高科目を分けるか**
> 全口座で単一の「初期残高」科目を共有すると、初期残高科目自体の残高が全口座分の合算になり、個々の口座の初期仕訳を特定・追跡しづらくなる。口座ごとに専用の初期残高科目(`initial_balance_for_account_id`で対象口座を明示)を発行することで、「この口座の初期残高はこの1科目だけに現れる」という対応が常に一意に保たれる。ユーザーには見せず、上級者モードでのみ内部が見える([4章 口座登録のUX](#4-口座登録のux)参照)。

### 3.2 DDL

```sql
CREATE TABLE accounts (
  id                   INTEGER PRIMARY KEY,
  category             TEXT NOT NULL
    CHECK (category IN ('asset','liability','equity','revenue','expense')),
  name                 TEXT NOT NULL,
  is_reconcilable      BOOLEAN,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_system_managed    BOOLEAN NOT NULL DEFAULT FALSE,
  household_member_id  INTEGER REFERENCES household_members(id),
  account_group_id     INTEGER REFERENCES account_groups(id),
  initial_balance_for_account_id INTEGER REFERENCES accounts(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (category = 'asset' AND is_reconcilable IS NOT NULL) OR
    (category != 'asset' AND is_reconcilable IS NULL)
  ),
  CHECK (
    initial_balance_for_account_id IS NULL OR
    (category = 'equity' AND is_system_managed = TRUE)
  )
);

CREATE INDEX idx_accounts_group ON accounts(account_group_id);
CREATE INDEX idx_accounts_initial_balance_for ON accounts(initial_balance_for_account_id);

-- 区分の変更を禁止
CREATE TRIGGER prevent_category_change
BEFORE UPDATE OF category ON accounts
WHEN OLD.category != NEW.category
BEGIN
  SELECT RAISE(ABORT, 'category cannot be changed');
END;

-- equity区分の新規作成はシステム管理科目のみ許可(ユーザーによる新規作成を禁止)
CREATE TRIGGER prevent_user_created_equity_account
BEFORE INSERT ON accounts
WHEN NEW.category = 'equity' AND NEW.is_system_managed = FALSE
BEGIN
  SELECT RAISE(ABORT, 'equity accounts can only be system-managed');
END;

-- 仕訳が紐づく科目の物理削除を禁止
CREATE TRIGGER prevent_delete_with_journal_lines
BEFORE DELETE ON accounts
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE account_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account with journal lines');
END;

-- 勘定科目名は区分内でユニーク(非アクティブは除外)
CREATE UNIQUE INDEX idx_accounts_unique_name_per_category
ON accounts(category, name)
WHERE is_active = TRUE;

-- updated_at の自動更新
CREATE TRIGGER accounts_set_updated_at
AFTER UPDATE ON accounts
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

> **ユニーク制約**
> 部分インデックス(`WHERE is_active = TRUE`)により、非アクティブ化した科目と同名の科目を新規作成できる。区分またぎのユニークは設けない。

### 3.3 勘定科目グループマスタ(account_groups)

[1.3](#13-グルーピング表示用)の通り、似た用途の勘定科目(例:水道代・ガス料金・電気代)を表示上まとめるためのラベル。`accounts.account_group_id`から単一所属で参照される([3.1](#31-フィールド定義)参照)。FS集計・仕訳の整合性検証には一切関与しない。

**フィールド定義**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | グループID | PK |
| `name` | グループ名 | 例:「水道光熱費」、自由記述 |
| `is_active` | 有効/非アクティブ | falseにしても既存科目の所属・過去集計に影響なし |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

`projects`・`counterparties`と同様、`category`・`is_reconcilable`・`is_system_managed`に相当するフィールドは持たない。すべてのグループはユーザー定義かつ対等であり、システムが特別扱いするグループは存在しない。

**ライフサイクル**

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 紐づく勘定科目が0件 | 可 |
| 物理削除 | 紐づく勘定科目が1件以上 | 不可(非アクティブ化のみ) |
| 名称変更 | 常に | 可 |
| 非アクティブ化 | 任意(例: 使わなくなった分類) | 既存科目の所属はそのまま維持され過去集計に影響しない。新規科目のグループ選択肢からは除外 |

**DDL**

```sql
CREATE TABLE account_groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 勘定科目が紐づくグループの物理削除を禁止
CREATE TRIGGER prevent_delete_account_group_with_accounts
BEFORE DELETE ON account_groups
WHEN EXISTS (SELECT 1 FROM accounts WHERE account_group_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete account group with accounts');
END;

-- グループ名はユニーク(非アクティブは除外)
CREATE UNIQUE INDEX idx_account_groups_unique_name
ON account_groups(name)
WHERE is_active = TRUE;

-- updated_at の自動更新
CREATE TRIGGER account_groups_set_updated_at
AFTER UPDATE ON account_groups
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE account_groups SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

> **単一所属は列で表現する**
> [household-members.md 1.5 グループ(複数メンバーの集合)](./household-members.md#15-グループ複数メンバーの集合)の世帯メンバーグループは多対多のため中間テーブル(`household_member_group_memberships`)が必要だったが、勘定科目グループは単一所属([1.3](#13-グルーピング表示用)参照)のため`accounts.account_group_id`という1列のFKのみで表現でき、中間テーブルは不要である。

---

## 4. 口座登録のUX

口座登録は専用ウィザードで行う。裏側で`accounts`に資産科目を1件作成する。ユーザーには「区分」「勘定科目」という語を見せない。

### 4.1 ウィザードと裏側の対応

| ユーザーが見る画面 | 裏側で作られるデータ |
|---|---|
| 「口座を登録する」ボタン | ― |
| ① 種類を選ぶ:銀行口座 / 現金 / 電子マネー / 証券・投資口座 | `category = 'asset'`が固定・非表示ですべて |
| ② 名前を付ける(例:三菱UFJ銀行) | `name = "三菱UFJ銀行"` |
| ③ 名義を選ぶ(任意、例:夫/妻/夫婦/共通) | `household_member_id`を設定(個人・グループを区別なく選択可、未選択なら世帯共通=`NULL`) |
| ④ 初期残高を入力(なくてもOK?) | 初期残高と相手科目に初期仕訳が自動生成 |

③は任意ステップとし、世帯メンバーを1人も登録していない場合はステップ自体を表示しない(単身利用のユーザーに複雑さを持ち込まないため)。

### 4.2 種類選択による照合可否の自動決定

| 選ぶ種類 | is_reconcilable | 体験差 |
|---|---|---|
| 銀行口座 / 電子マネー | `true` | 後でCSV明細の取込・突合が使える |
| 現金 | `false` | 残高を数えて調整する実残機能が使える |
| 証券・投資口座 | `true` | 評価額の手動更新など |

### 4.3 初期残高の自動仕訳

「初期残高10万円」の入力で、まず口座専用の初期残高科目(`category = 'equity'`, `is_system_managed = true`, `initial_balance_for_account_id` = 対象の資産科目ID、[3.1](#31-フィールド定義)参照)が自動生成され、続けて以下の仕訳が裏で生成される。ユーザーは純資産という概念を理解する必要がない。

```
(借) 資産・三菱UFJ銀行           100,000
(貸) 純資産・初期残高(三菱UFJ銀行)  100,000
```

この初期仕訳の`journal_lines.household_member_id`は明示的に設定しない。口座(`accounts.household_member_id`)に既定値が設定されていれば、[household-members.md 1.2](./household-members.md#12-紐づけ対象と既定値の継承)の継承ルールにより自動的にその名義として扱われる。

> **段階的開示**
> シンプルUI / 上級者モードの方針に沿い、上級者モードでのみ内部(資産科目としての登録)が見える。通常はタスク単位の体験で完結させる。
