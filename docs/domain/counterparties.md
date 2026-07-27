# 取引先ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、取引先(Counterparty)に関する詳細設計。

---

## 目次

1. [取引先](#1-取引先)
2. [取引先マスタ(counterparties)](#2-取引先マスタcounterparties)

---

## 1. 取引先

### 1.1 位置づけ

取引先は「誰に対して/どこで支払った(または誰から受け取った)取引か」を表す軸であり、勘定科目(用途)・プロジェクト(目的)・世帯メンバー(誰の)とも独立する。[domain.md 1.1](../domain.md#11-基本方針)の方針の通り、勘定科目の階層に混ぜ込まず独立したエンティティとして持ち、プロジェクト・世帯メンバーと合わせて仕訳を分類する4本目の直交軸となる。

CSVインポート時に相手勘定科目を自動推定するための土台としても機能する([1.3](#13-csvインポートとの関係)参照)。

### 1.2 紐づけ対象

取引先は仕訳明細(JournalLine)単位で紐づける。プロジェクトと同様、**PL科目(収益・費用)の行にのみ**設定可能とする。

**なぜ行レベルか(ヘッダーではなく)**
1回の支払い・受取りが必ずしも1仕訳=1取引先とは限らない。例えば、クレジットカードの引き落とし明細をCSVで取り込み、複数店舗の買い物内訳を1つの複合仕訳(未払金の消込)にまとめて記帳する運用では、取引先は費用側の行ごとに異なりうる。一方、CSVの1行を1仕訳として個別に取り込む運用では、単に「その仕訳のPL行すべてに同じcounterparty_idを設定する」ことで結果的に同じ状態を表現できる。

つまり行レベルに持たせておけば、「CSVの1行を1仕訳とするか、まとめて1仕訳とするか」というインポート方式のどちらを採っても破綻しない。逆に仕訳ヘッダー(`journal_entries`)側に持たせると、複数取引先が1仕訳に混在するケースを表現できなくなる。CSVインポートの取り込み粒度自体は`Importer`層の実装判断であり本設計書のスコープ外だが、データモデル側はどちらの方式にも対応できる形にしておく。

資産・負債・純資産の行(口座残高側)には設定できない。相手方は「何を買ったか/得たか」というPL側の性質であり、口座側(BSの残高管理)とは軸が異なるため。

> **なぜCHECK制約ではなくTRIGGERで強制するか**
> project_id([projects.md 1.2 紐づけ対象](./projects.md#12-紐づけ対象))と同じ理由。`journal_lines.account_id`から`accounts.category`を参照して判定する必要があり、SQLiteのCHECK制約はサブクエリを許可しないため、BEFORE INSERT/UPDATEのTRIGGERで実装する([journal.md 2.2 DDL](./journal.md#22-ddl)参照)。

### 1.3 CSVインポートとの関係

CSV明細の摘要欄(例:「AMAZON.CO.JP」「イオン○○店」)から取引先を特定するため、`counterparty_patterns`に取引先ごとの部分一致パターンを登録する([2章 取引先マスタ](#2-取引先マスタcounterparties)参照)。

1. CSVの摘要文字列を正規化する(全角半角統一・大文字小文字統一・空白除去)
2. 登録済みの`pattern`と部分一致(`LIKE '%pattern%'`)で照合する
3. マッチが1件 → 取引先候補として自動セットする
4. マッチが0件、または複数件(曖昧) → 自動確定せず、レビュー画面でユーザーに選択を委ねる
5. ユーザーが手動で取引先を確定させた場合、その生の摘要文字列を新しい`pattern`として`counterparty_patterns`に自動登録する(学習)。次回以降、同じ表記の摘要は自動マッチするようになる

銀行・カード会社の摘要は表記ゆれが大きい(例:「AMAZON.CO.JP」「AMAZON CO JP TOKYO」)ため、完全一致ではなく部分一致で緩く照合する。曖昧なマッチ(複数取引先に該当)は自動確定させず必ずユーザー確認を挟むことで、誤った取引先の自動割当を避ける。

マッチングロジック自体(正規化の詳細、学習のタイミング等)の実装は`Importer`層([architecture.md](../architecture.md) 12章)の責務とし、本設計書ではマスタのデータモデルとマッチングの基本方針のみを定義する。

### 1.4 勘定科目のデフォルトサジェスト

取引先が特定できた場合、`counterparties.default_account_id`をCSVレビュー画面の相手勘定科目欄の初期値としてサジェストする。ユーザーは確認・修正した上で確定するため強制力は持たない。勘定科目の`category`([accounts.md 2.1 操作ルール](./accounts.md#21-操作ルール)参照)のような不可変制約とは異なり、いつでも変更可能な初期値に過ぎない。

MVPでは取引先1件につき`default_account_id`は1つの固定値とする。同一取引先でも購入内容によって科目が変わるケース(例:イオンで食品も日用品も買う)では精度が下がるが、初期値をユーザーが上書きすればよいため実用上の支障はないと考える。将来的には以下のような拡張が考えられる(いずれも本設計書ではスコープ外、将来課題として明記するに留める)。

- 過去の仕訳履歴からその取引先の最頻出科目を動的に算出してサジェストする方式への切り替え
- 取引先1件に対して複数の科目候補を優先順位付きで登録できるようにする拡張

### 1.5 ライフサイクル

勘定科目・プロジェクトと同様、削除ではなく非アクティブ化を基本とする。

| 操作 | 条件 | 扱い |
|---|---|---|
| 物理削除 | 紐づく仕訳明細が0件 | 可 |
| 物理削除 | 紐づく仕訳明細が1件以上 | 不可(非アクティブ化のみ) |
| 名称変更 | 常に | 可 |
| `default_account_id`の変更 | 常に | 可(あくまで初期値のため、勘定科目の`category`のような不可変制約は設けない) |
| 非アクティブ化 | 任意(例: 閉店・退会) | 過去集計はそのまま表示、新規仕訳では選択不可 |

プロジェクトと同様、`category`や`is_system_managed`に相当する概念は持たない。すべての取引先はユーザー定義であり、システムが特別扱いする取引先は存在しない。

### 1.6 収益側の取引先

取引先は費用側(支払先)だけでなく、収益側(給与の振込元企業、副業の取引先など)にも同様に紐づけられる。「どの取引先からの収益か」を集計できることは、費用側の「どこで使ったか」と対称的なユースケースとして扱う。`counterparties`テーブルに区分(category)は持たせず、費用・収益いずれの勘定科目も`default_account_id`として指せるようにする。

### 1.7 集計への影響

[financial-statements.md 2章 財務諸表(FS)](./financial-statements.md#2-財務諸表fs)の期間集計、[projects.md 1.4 集計への影響](./projects.md#14-集計への影響)のプロジェクト別集計、[household-members.md 1.4 集計への影響](./household-members.md#14-集計への影響)のメンバー別集計と独立した軸として、「取引先別の収支合計」を提供する。

```
取引先別合計(counterparty, 区分に応じて符号反転) =
  Σ(amount WHERE side = 増加側) - Σ(amount WHERE side = 減少側)
  (counterparty_id = 対象取引先、期間で絞らず全期間が既定)
```

期間・プロジェクト・世帯メンバー・取引先の4軸は互いに独立しており、任意の組み合わせで絞り込める(例:「今月・Amazon・夫」の支出)。

---

## 2. 取引先マスタ(counterparties)

### 2.1 フィールド定義

**counterparties**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 取引先ID | PK |
| `name` | 取引先名 | 例:「イオン」「Amazon」「株式会社◯◯(給与振込元)」、自由記述 |
| `default_account_id` | 相手勘定科目のデフォルト | FK、任意。CSVレビュー画面での初期値サジェストに用いる([1.4](#14-勘定科目のデフォルトサジェスト)参照)。強制力はなく、いつでも変更可 |
| `is_active` | 有効/非アクティブ | falseにしても過去仕訳・過去集計に影響なし |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**counterparty_patterns**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | パターンID | PK |
| `counterparty_id` | 取引先ID | FK、親削除時はCASCADE |
| `pattern` | CSV摘要とのマッチング用文字列 | 部分一致。ユーザーの手動選択時に自動登録される([1.3](#13-csvインポートとの関係)参照) |
| `created_at` | 作成日時 | |

プロジェクト・世帯メンバーと異なり、`category`(区分)・`is_reconcilable`・`is_system_managed`に相当するフィールドは持たない。取引先はすべてユーザー定義かつ対等であり、費用側・収益側いずれの相手にもなりうる([1.6](#16-収益側の取引先)参照)。

### 2.2 DDL

```sql
CREATE TABLE counterparties (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  default_account_id  INTEGER REFERENCES accounts(id),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE counterparty_patterns (
  id               INTEGER PRIMARY KEY,
  counterparty_id  INTEGER NOT NULL
    REFERENCES counterparties(id) ON DELETE CASCADE,
  pattern          TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_counterparty_patterns_counterparty
  ON counterparty_patterns(counterparty_id);

-- 仕訳明細が紐づく取引先の物理削除を禁止
CREATE TRIGGER prevent_delete_counterparty_with_journal_lines
BEFORE DELETE ON counterparties
WHEN EXISTS (SELECT 1 FROM journal_lines WHERE counterparty_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'cannot delete counterparty with journal lines');
END;

-- updated_at の自動更新
CREATE TRIGGER counterparties_set_updated_at
AFTER UPDATE ON counterparties
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE counterparties SET updated_at = datetime('now') WHERE id = NEW.id;
END;
```

> **取引先名のユニーク制約は設けない**
> 勘定科目([accounts.md 3.2 DDL](./accounts.md#32-ddl))とは異なり、取引先名の重複を防ぐユニーク制約は設けない。同名の店舗が複数チェーン展開しているケースなど、名称だけでは一意に区別できない実務上のケースを許容するため。重複登録の防止(既存取引先のサジェスト等)はUI側に委ねる。
