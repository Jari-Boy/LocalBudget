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
> 「普通預金」のような`is_reconcilable = true`の資産科目を直接使う仕訳は、[reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産負債への直接記帳の制限)の通り`source_type`が`external_import`(CSVインポート由来)・`initial_balance`(口座開設時の初期残高)・`balance_adjustment`(残高調整)のいずれかの仕訳に限られる([1.7 作成経路(source_type)](#17-作成経路source_type)参照)。「給与が振り込まれる」の例はCSV到着時にその場で記帳するケースを表す。CSV到着前に先に記帳したい場合は「給与を先に見込み計上」のように未収金・未払金を経由した暫定計上を行い、CSV到着後にそれを消し込む([reconciliation.md 1.4](./reconciliation.md#14-暫定記帳未払金未収金と消込)参照)。

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

**物理削除は常に許可する**([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)。取消仕訳(反対仕訳)を挟むことは強制しない。[accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」は反対仕訳([1.8](#18-仕訳間の関係journal_entry_links)の`reverses`)で扱うが、これは科目マスタ側の大量の過去仕訳を一括付け替えする特殊な操作の文脈であり、1件の仕訳を日常的に編集・削除する場面にまで同じ重さを求めると、入力ミスの訂正が煩雑になり[domain.md 1.1 基本方針](../domain.md#11-基本方針)の「会計知識のない一般ユーザーにも使える」という方針に反する。日常的な訂正では`journal_entry_links`を作らず、物理削除・直接編集のみで完結させる。[1.8](#18-仕訳間の関係journal_entry_links)の通り、フィールド単位の変更履歴(何をいつ変更したか)は引き続き持たない。

**`source_type = 'external_import'`の仕訳(CSVインポート由来、[reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産負債への直接記帳の制限)参照)も、`is_reconcilable`資産側の`account_id`/`amount`/`side`や`entry_date`を含め編集を許可する**(Issue #1で決着)。ただし編集すると、対応する`external_transaction_refs`が指す元のCSV明細との対応が崩れるため、UI上で警告する。[reconciliation.md 1.3](./reconciliation.md#13-is_reconcilable資産負債への直接記帳の制限)の「CSV由来のみ許可」はあくまで**作成経路(`source_type`)**の制約であり、事後の内容がCSVの生データと一致し続けることまでは保証しない。内容が誤っていた場合、削除して正しい内容で再取込する([reconciliation.md 1.7](./reconciliation.md#17-ライフサイクル)参照)か、その場で編集するかはユーザーの選択に委ねる。

### 1.6 CSVインポートとの関係

CSVインポート時の相手勘定科目の自動推定は、取引先マスタを介したサジェスト機能として[counterparties.md 1章](./counterparties.md#1-取引先)で定義する。本章で定義した仕訳・仕訳明細のデータモデルと貸借バランス検証は、CSVインポート経由・マニュアル起票経由のいずれからも共通して使われる土台として位置づける([architecture.md](../architecture.md) 12章の方針の通り)。

### 1.7 作成経路(source_type)

`journal_entries`は、どのような経路で作られたかを`source_type`として持つ。

| 値 | 意味 |
|---|---|
| `manual` | 手入力(既定値) |
| `external_import` | 外部データの取り込み(CSVインポート等)のレビュー確定を経て作成された。通常の取引・消込のどちらも含む |
| `recurring_generated` | 定期取引([recurring-transactions.md](./recurring-transactions.md))の提案をレビュー確認して作成された |
| `initial_balance` | 口座/カード開設時の初期残高仕訳([accounts.md 4.3 初期残高の自動仕訳](./accounts.md#43-初期残高の自動仕訳)) |
| `balance_adjustment` | 残高調整([reconciliation.md 1.9](./reconciliation.md#19-原因不明差異への残高調整)、[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)) |

`source_type`は、[reconciliation.md 1.3 is_reconcilable資産・負債への直接記帳の制限](./reconciliation.md#13-is_reconcilable資産負債への直接記帳の制限)が「この仕訳はis_reconcilable = trueの科目に記帳してよいか」を判定する唯一の根拠になる。

> **なぜ`external_transaction_refs`の存在ではなく`source_type`で判定するか**
> 以前は「is_reconcilable = trueの科目を使う行に対応する`external_transaction_refs`があるか」を根拠にしていたが、これは「作成経路(この仕訳はどうやって生まれたか)」と「外部データとの照合材料(この科目の残高は外部の何と一致するはずか)」という別々の関心事を1つのテーブルに同居させていた。両者が食い違うケース(クレジットカードの消込で、決済相手のカード科目には対応する外部CSV行が存在しない場合等)で無理が生じていた。`source_type`は前者(作成経路)だけを担い、`external_transaction_refs`([reconciliation.md 2章](./reconciliation.md#2-突合マスタexternal_transaction_refs)参照)は後者(照合材料)だけを担うことで関心事を分離する。仕訳が複数のis_reconcilable = true科目にまたがる場合(消込等)も、仕訳単位の`source_type`が1回チェックされるだけで済み、行ごとに参照の有無を確認する必要がない。

### 1.8 仕訳間の関係(journal_entry_links)

消込・反対仕訳のように、ある仕訳が別の仕訳と関係を持つ場合、その関係を`journal_entry_links`([2.3](#23-仕訳間の関係マスタjournal_entry_links)参照)に記録する。

- `settles`(消込): `from_entry`(消込仕訳)が`to_entry`(未払金・未収金・カード利用明細等の元仕訳)を消し込む。1件の消込が複数の元仕訳を一括で消し込む複合仕訳もあるため、多対一になりうる([reconciliation.md 1.4](./reconciliation.md#14-暫定記帳未払金未収金と消込)参照)。`amount`に消込額を持ち、金額が一致しない部分消込([reconciliation.md 1.4 消込は金額が一致するとは限らない](./reconciliation.md#14-暫定記帳未払金未収金と消込)参照)も表現できる
- `reverses`(反対仕訳): `from_entry`(反対仕訳)が`to_entry`(訂正対象の元仕訳)を打ち消す。[accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」で使う

いずれの関係も、ある仕訳の詳細画面から`from_entry_id = X OR to_entry_id = X`で関連する仕訳を辿れるようにするためのものであり、複式簿記の整合性検証([1.3](#13-貸借バランスの検証))自体には関与しない。

> **監査ログ(何をいつ変更したか)とは別物**
> [1.5 仕訳の編集・削除](#15-仕訳の編集削除)の通り、フィールド単位の変更履歴(誰が・いつ・何を変更したか)は持たない。`journal_entry_links`が記録するのは「独立した仕訳同士がどう関係するか」であり、1件の仕訳自体の編集履歴ではない。日常的な入力ミスの訂正(物理削除・直接編集)には`journal_entry_links`を作らず、[1.5](#15-仕訳の編集削除)の軽い訂正フローのままにする。

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
| `source_type` | 作成経路 | ENUM、既定`manual`([1.7 作成経路(source_type)](#17-作成経路source_type)参照) |
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

実装: [schema/journal.sql](../schema/journal.sql)

> **貸借バランスはDBで強制しない**
> [1.3](#13-貸借バランスの検証)の通り、SQLiteのTRIGGERは行単位で即時発火するため、「1仕訳内で借方合計=貸方合計」という複数行にまたがる制約を実用的に強制できない。この検証は`JournalEntryRepository`が担う。

### 2.3 仕訳間の関係マスタ(journal_entry_links)

[1.8 仕訳間の関係](#18-仕訳間の関係journal_entry_links)の通り、消込・反対仕訳といった仕訳同士の関係を記録する。

**フィールド定義**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ID | PK |
| `from_entry_id` | 関係の起点となる仕訳 | FK、親削除時CASCADE。消込なら消込仕訳、反対仕訳なら打ち消す側の仕訳 |
| `to_entry_id` | 関係の対象となる仕訳 | FK、親削除時CASCADE。消込なら元の利用明細等の仕訳、反対仕訳なら訂正対象の仕訳 |
| `link_type` | 関係の種別 | ENUM: `settles`(消込)/`reverses`(反対仕訳) |
| `amount` | 関係する金額 | `link_type = 'settles'`のときのみ必須(部分消込の金額を表す)。`reverses`では常にNULL(全額の打ち消しが前提のため) |
| `created_at` | 作成日時 | |

**DDL**

実装: [schema/journal.sql](../schema/journal.sql)

> **`journal_entries`が削除されたら関係も消える**
> `ON DELETE CASCADE`により、`from_entry_id`・`to_entry_id`いずれかの仕訳が削除されると、その関係行も自動的に削除される。[1.5 仕訳の編集・削除](#15-仕訳の編集削除)の通り仕訳の物理削除は常に許可されるため、削除後に関係だけが宙に浮いた状態(存在しない仕訳を指す行)が残ることはない。
