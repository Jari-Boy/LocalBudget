# 仕訳ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、仕訳(JournalEntry)・仕訳明細(JournalLine)に関する詳細設計。

---

## 目次

1. [仕訳ドメイン](#1-仕訳ドメイン)
   - [1.1 仕訳(JournalEntry)と仕訳明細(JournalLine)](#11-仕訳journalentryと仕訳明細journalline)
   - [1.2 記帳の型(具体例)](#12-記帳の型具体例)
   - [1.3 貸借バランスの検証](#13-貸借バランスの検証)
   - [1.4 金額と通貨](#14-金額と通貨)
   - [1.5 仕訳の編集・削除](#15-仕訳の編集削除)
   - [1.6 外部明細取込との関係](#16-外部明細取込との関係)
   - [1.7 作成経路(source_type)](#17-作成経路source_type)
   - [1.8 仕訳間の関係(journal_entry_links)](#18-仕訳間の関係journal_entry_links)
2. [仕訳マスタ(journal_entries・journal_lines)](#2-仕訳マスタjournal_entriesjournal_lines)
   - [2.1 フィールド定義](#21-フィールド定義)
   - [2.2 DDL](#22-ddl)
   - [2.3 仕訳間の関係マスタ(journal_entry_links)](#23-仕訳間の関係マスタjournal_entry_links)
3. [仕訳の下書き(journal_entry_drafts)](#3-仕訳の下書きjournal_entry_drafts)
   - [3.1 位置づけ](#31-位置づけ)
   - [3.2 ライフサイクル](#32-ライフサイクル)
   - [3.3 フィールド定義](#33-フィールド定義)
   - [3.4 DDL](#34-ddl)

---

## 1. 仕訳ドメイン

### 1.1 仕訳(JournalEntry)と仕訳明細(JournalLine)

取引は「仕訳(JournalEntry)」という単位で記録される。仕訳は日付・摘要を持つヘッダーであり、実際の金額の増減は子レコードである「仕訳明細(JournalLine)」に記録される。1件の仕訳は2件以上の仕訳明細から成り、その合計金額は借方・貸方で必ず一致する(複式簿記の恒等式)。

仕訳明細は勘定科目に加えて、任意でプロジェクト([projects.md 1章](./projects.md#1-プロジェクト))・世帯メンバー([household-members.md 1章](./household-members.md#1-世帯メンバー))を紐づけられる。

| 概念           | 役割                                         | 例                          |
| ------------ | ------------------------------------------ | -------------------------- |
| JournalEntry | 1つの取引のヘッダー。日付・摘要                           | 「2026-07-20 スーパーで食材購入」     |
| JournalLine  | 仕訳を構成する各行。勘定科目・金額・借方/貸方・(任意で)プロジェクト・世帯メンバー | 「(借)食費 3,000」「(貸)現金 3,000」 |

最もシンプルな仕訳は2行(借方1行・貸方1行)である。1つの支払いを複数の費目にまたがって計上する複合仕訳では3行以上になる。

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
> 「普通預金」のような`is_reconcilable = true`の資産科目を直接使う仕訳は、`source_type`が`external_import`・`initial_balance`・`balance_adjustment`のいずれかに限られる。この制約は[reconciliation.md 1.2](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限)による([1.7 作成経路(source_type)](#17-作成経路source_type)参照)。「給与が振り込まれる」の例はCSV到着時にその場で記帳するケースを表す。CSV到着前に先に記帳したい場合は「給与を先に見込み計上」のように未収金・未払金を経由した暫定計上を行い、CSV到着後にそれを消し込む([settlement.md](./settlement.md)参照)。

### 1.3 貸借バランスの検証

1件の仕訳(JournalEntry)に属する仕訳明細(JournalLine)は、借方合計と貸方合計が常に一致しなければならない。

```
Σ(amount WHERE side = 'debit')  ==  Σ(amount WHERE side = 'credit')
  (同一 journal_entry_id 内)
```

**検証はRepository層(アプリケーションコード)で行う。** SQLiteのTRIGGERは行単位(`FOR EACH ROW`)で即時発火するため、仕訳明細を1行ずつINSERTする通常のフローでは「1行目を書き込んだ時点では借方だけで貸方がまだ無い」という中間状態を経由する。この中間状態でトリガーが借方・貸方の不一致を検出して即ABORTしてしまうため、複数行にまたがる集約制約をDBトリガーで実用的に強制することはできない。

そのため、`JournalEntryRepository`が仕訳を作成・更新する際に、ヘッダーと全ての明細行をまとめて構築する。そのうえで、ひとつのDBトランザクションへの書き込み直前に、借方合計・貸方合計の一致をアプリケーションコードとして検証する。不一致であれば書き込みを行わず、ドメインエラー(例: `UnbalancedJournalEntryError`)を返す。DB側は単一行として成立しない異常値(`amount <= 0`等)のみCHECK制約で弾き、行をまたぐ整合性はDBに委ねない。

マニュアル起票・外部明細取込いずれの経路でも、最終的にこの`JournalEntryRepository`を経由するため、入力経路によって整合性ルールが分岐することはない([architecture.md](../architecture.md) 12章の方針と一致)。

> **実装上、2件以上の明細数の検証([1.1](#11-仕訳journalentryと仕訳明細journalline))も同じ関数・同じエラー型で表現する**
> `assertJournalBalance`(純粋関数)は借方合計・貸方合計の比較に加えて、明細が2件未満の場合も同じ`UnbalancedJournalEntryError`をスローする(専用のエラー型を新設しない)。ただしメッセージは省略時の「貸借不一致」を表す文言ではなく、明細数不足であることを明示する専用メッセージ(`at least 2 lines`を含む)を渡す。これにより呼び出し側は`instanceof UnbalancedJournalEntryError`という単一の判定で「有効な仕訳として成立しない」ケースを網羅的に捕捉できる一方、エラーメッセージから貸借不一致と明細数不足のどちらが原因かを区別できる。

### 1.4 金額と通貨

- 金額は通貨の最小単位(日本円なら1円単位)の整数値として保持する([architecture.md](../architecture.md) 13章の方針を踏襲)。浮動小数点は用いない。
- 通貨コードはISO 4217に準拠し、`journal_entries`にヘッダー単位で持たせる。1つの取引(仕訳)内で複数通貨が混在するケースは想定しないため、明細ではなくヘッダーの属性とする。
- MVPでは日本円(`JPY`)固定で扱う。実際の多通貨レート換算ロジックは将来課題であり、スコープ外である。

### 1.5 仕訳の編集・削除

- [financial-statements.md 1章 期間確定と締め](./financial-statements.md#1-期間確定と締め)の方針により、過去の仕訳の編集・削除は常に可能とする。ロックは設けない。
- 明細行を編集する場合も、保存前に[1.3](#13-貸借バランスの検証)のバランス検証を通す。
- 編集のたびに`journal_entries.updated_at`を更新する(明細行自体は`updated_at`を持たない。[2.1 フィールド定義](#21-フィールド定義)参照)。

**物理削除は常に許可する**([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)。反対仕訳を挟むことは強制しない。日常的な訂正では`journal_entry_links`を作らず、物理削除・直接編集のみで完結させる。

**`JournalEntryRepository.deleteByProjectId(projectId)`で、あるプロジェクト([projects.md 1章](./projects.md#1-プロジェクト))にタグ付けされた仕訳をまとめて物理削除できる**([GitHub Issue #52](https://github.com/Jari-Boy/LocalBudget/issues/52)で決着)。誤って投入した割勘バッチ([expense-splitting.md 1.2 一時勘定(立替金)](./expense-splitting.md#12-一時勘定立替金)参照、割勘バッチは立替金行にタグ付けられた`project_id`で識別される)を1件ずつ`delete(id)`で消す代わりに、対象`project_id`が`journal_lines.project_id`にタグ付けされた`journal_entries`を一括で取り消せる。`SqlJsJournalEntryRepository`の実装は、単一のDBトランザクション(BEGIN〜COMMIT)内で対象仕訳をまとめてDELETEするall-or-nothing方式であり、`journal_lines`・`journal_entry_links`への波及は既存の`ON DELETE CASCADE`([2.3](#23-仕訳間の関係マスタjournal_entry_links))にすべて委ねる。上記の「物理削除は常に許可する」方針をそのまま踏襲するため、削除対象に精算済み(`settles`リンクを持つ)仕訳が混在していてもガードしない。対象`project_id`を持つ仕訳が0件の場合は何もせず正常終了する([expense-splitting.md 1.5 割勘の履歴と取り消し](./expense-splitting.md#15-割勘の履歴と取り消し)も参照)。

[accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」は反対仕訳([1.8](#18-仕訳間の関係journal_entry_links)の`reverses`)で扱う。これは科目マスタ側の大量の過去仕訳を一括付け替えする特殊な操作の文脈である。1件の仕訳を日常的に編集・削除する場面にまで同じ重さを求めると、入力ミスの訂正が煩雑になり、[domain.md 1.1 基本方針](../domain.md#11-基本方針)の「会計知識のない一般ユーザーにも使える」という方針に反する。[1.8](#18-仕訳間の関係journal_entry_links)の通り、フィールド単位の変更履歴(何をいつ変更したか)は引き続き持たない。

**`source_type = 'external_import'`の仕訳(外部明細取込由来)も、`is_reconcilable`資産側の`account_id`/`amount`/`side`や`entry_date`を含め編集を許可する**(Issue #1で決着)。ただし編集すると、対応する`external_transaction_refs`が指す元のCSV明細との対応が崩れるため、UI上で警告する。[reconciliation.md 1.2](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限)の「CSV由来のみ許可」はあくまで**作成経路(`source_type`)**の制約であり、事後の内容がCSVの生データと一致し続けることまでは保証しない。内容が誤っていた場合、削除して正しい内容で再取込する([reconciliation.md 1.4](./reconciliation.md#14-ライフサイクル)参照)か、その場で編集するかはユーザーの選択に委ねる。

### 1.6 外部明細取込との関係

外部明細取込時の相手勘定科目の自動推定は、取引先マスタを介したサジェスト機能として[counterparties.md 1章](./counterparties.md#1-取引先)で定義する。本章で定義した仕訳・仕訳明細のデータモデルと貸借バランス検証は、外部明細取込経由・マニュアル起票経由のいずれからも共通して使われる土台として位置づける([architecture.md](../architecture.md) 12章の方針の通り)。

### 1.7 作成経路(source_type)

`journal_entries`は、どのような経路で作られたかを`source_type`として持つ。

| 値 | 意味 |
|---|---|
| `manual` | 手入力(既定値) |
| `external_import` | 外部明細取込のレビュー確定を経て作成された。通常の取引・消込のどちらも含む |
| `recurring_generated` | 定期取引([recurring-transactions.md](./recurring-transactions.md))の提案をレビュー確認して作成された |
| `initial_balance` | 口座/カード開設時の初期残高仕訳([accounts.md 4.3 初期残高の自動仕訳](./accounts.md#43-初期残高の自動仕訳)) |
| `balance_adjustment` | 残高調整([reconciliation.md 1.6](./reconciliation.md#16-原因不明差異への残高調整)、[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)) |

`source_type`は、[reconciliation.md 1.2 is_reconcilable資産・負債への直接記帳の制限](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限)が「この仕訳はis_reconcilable = trueの科目に記帳してよいか」を判定する唯一の根拠になる。

> **なぜ`external_transaction_refs`の存在ではなく`source_type`で判定するか**
> 以前は「is_reconcilable = trueの科目を使う行に対応する`external_transaction_refs`があるか」を根拠にしていたが、これは「作成経路(この仕訳はどうやって生まれたか)」と「外部データとの突合材料(この科目の残高は外部の何と一致するはずか)」という別々の関心事を1つのテーブルに同居させていた。両者が食い違うケース(初期残高・残高調整の仕訳のように、is_reconcilable = true科目を使う仕訳でも対応する外部CSV行が存在しない場合等)で無理が生じていた。`source_type`は前者(作成経路)だけを担い、`external_transaction_refs`([reconciliation.md 2章](./reconciliation.md#2-突合マスタexternal_transaction_refs)参照)は後者(突合材料)だけを担うことで関心事を分離する。仕訳が複数のis_reconcilable = true科目にまたがる場合(口座間振替等)も、仕訳単位の`source_type`が1回チェックされるだけで済み、行ごとに参照の有無を確認する必要がない。

### 1.8 仕訳間の関係(journal_entry_links)

消込・按分のように、ある仕訳が別の仕訳と関係を持つ場合、その関係を`journal_entry_links`([2.3](#23-仕訳間の関係マスタjournal_entry_links)参照)に記録する。

- `settles`(消込): `from_entry`(消込仕訳)が`to_entry`(未払金・未収金・カード利用明細等の元仕訳)を消し込む。1件の消込が複数の元仕訳を一括で消し込む複合仕訳もあれば(多対一)、逆に1件の元仕訳が分割払いのように複数回のCSV取込にまたがって段階的に消し込まれることもある(一対多)。`to_entry_id`にユニーク制約は課さず、いずれの方向の一対多・多対一も同じテーブル構造で表現する([settlement.md](./settlement.md)参照)。`amount`に消込額を持ち、金額が一致しない部分消込([settlement.md 消込は金額が一致するとは限らない](./settlement.md#12-家賃給与の例)参照)や、複数回にわたる分割消込の完了判定([settlement.md 1.6 分割消込](./settlement.md#16-分割消込消込残高による完了判定)参照)も表現できる。
- `allocates`(按分): `from_entry`(割勘仕訳)が`to_entry`(按分対象の元の支出仕訳)の一部を按分する対象であることを示す。元仕訳自体は変更せず、按分は追加の仕訳として積む([expense-splitting.md](./expense-splitting.md)参照)。1回の割勘バッチが複数の元仕訳をまとめて対象にすることもあるため、`settles`と同様に一対多になりうる。`amount`にはその元仕訳に対する按分額を持つ。

いずれの関係も、ある仕訳の詳細画面から`from_entry_id = X OR to_entry_id = X`で関連する仕訳を辿れるようにするためのものであり、複式簿記の整合性検証([1.3](#13-貸借バランスの検証))自体には関与しない。

> **settlesリンクは消込仕訳自体の作成と同一トランザクションで書き込まれる**
> `settles`リンクは、消込仕訳(`from_entry`)自体の仕訳ヘッダー・明細行の書き込みと同じDBトランザクション内でまとめて書き込む。これは[settlement.md 1.8 タグ不整合の予防と検知](./settlement.md#18-タグ不整合の予防と検知)の作成時ハード検証が失敗した場合に、仕訳・明細・リンクのいずれもコミットされない([1.3](#13-貸借バランスの検証)と同じ「書き込み直前に検証し、不一致なら書き込みを行わない」パターン)ことを保証するためである。作成済みの2つの仕訳間へ事後的にリンクを追加する場合(例: `allocates`の追加付与)はこの限りではなく、独立したトランザクションで作成する。

> **監査ログ(誰が・いつ・何を変更したか)とは別物**
> [1.5 仕訳の編集・削除](#15-仕訳の編集削除)の通り、フィールド単位の変更履歴(何をいつ変更したか)は持たない。`journal_entry_links`が記録するのは「独立した仕訳同士がどう関係するか」であり、1件の仕訳自体の編集履歴ではない。日常的な入力ミスの訂正(物理削除・直接編集)には`journal_entry_links`を作らず、[1.5](#15-仕訳の編集削除)の軽い訂正フローのままにする。
>
> **`reverses`(反対仕訳)は持たない**
> 以前は科目統合([accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」)のために反対仕訳+再計上という方式を想定していたが、これは仕訳件数が最大3倍に膨らむ割に、家計簿アプリの利用者層には監査証跡としての価値が薄いと判断した。科目統合・取引先統合は直接UPDATE+操作ログ([accounts.md 2.2](./accounts.md#22-過去仕訳の付け替え)・[counterparties.md 1.5](./counterparties.md#15-ライフサイクル)参照)に置き換え、`reverses`の唯一の用途が消滅したため設計から削除した。厳密な反対仕訳による訂正をしたいユーザーは、`journal_entry_links`を介さない通常の手入力仕訳として自分で管理すればよい。

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
| `project_id`          | プロジェクトID      | FK、任意。全区分の行に設定可([projects.md 1.2](./projects.md#12-紐づけ対象)参照)              |
| `household_member_id` | 世帯メンバーID(上書き) | FK、任意。全区分で設定可。NULL=`accounts.household_member_id`を継承([household-members.md 1.2](./household-members.md#12-紐づけ対象と既定値の継承)参照) |
| `counterparty_id`     | 取引先ID         | FK、任意。PL科目(revenue/expense)の行にのみ設定可(TRIGGERで強制、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)参照)              |
| `side`                | 借方/貸方         | ENUM: debit/credit                                                              |
| `amount`              | 金額            | 通貨最小単位の正の整数                                                                     |
| `created_at`          | 作成日時          |                                                                                 |

> 明細行自体には`updated_at`を持たせない。明細の変更は「仕訳ヘッダー配下の行構成をまるごと差し替える」操作としてRepository層が扱い、変更の痕跡は親である`journal_entries.updated_at`側に集約する([1.5](#15-仕訳の編集削除)参照)。
>
> **`journal_lines.id`は更新のたびに再採番され、保持されない**
> `JournalEntryRepository.update`は既存の明細行を全削除してから入力内容を新規行として再挿入する実装(`SqlJsJournalEntryRepository`)であるため、更新後の`JournalLine.id`は更新前の値と一致しない。現時点で`journal_lines.id`を外部から参照するテーブル・機能は存在しないため実害はないが、将来明細行単位で外部参照を持たせる機能を追加する場合はこの前提に注意する必要がある。

### 2.2 DDL

実装: [schema/journal.sql](../schema/journal.sql)

> **貸借バランスはDBで強制しない**
> [1.3]の通り、DBでは強制しない。この検証は`JournalEntryRepository`が担う。

### 2.3 仕訳間の関係マスタ(journal_entry_links)

[1.8 仕訳間の関係](#18-仕訳間の関係journal_entry_links)の通り、消込・按分といった仕訳同士の関係を記録する。

**フィールド定義**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ID | PK |
| `from_entry_id` | 関係の起点となる仕訳 | FK、親削除時CASCADE。消込なら消込仕訳、按分なら割勘仕訳 |
| `to_entry_id` | 関係の対象となる仕訳 | FK、親削除時CASCADE。消込なら元の利用明細等の仕訳、按分なら按分対象の元の支出仕訳 |
| `link_type` | 関係の種別 | ENUM: `settles`(消込)/`allocates`(按分、[expense-splitting.md](./expense-splitting.md)参照) |
| `amount` | 関係する金額 | 必須。`settles`は消込額(部分消込を表現できる)、`allocates`はその元仕訳に対する按分額 |
| `created_at` | 作成日時 | |

**DDL**

実装: [schema/journal.sql](../schema/journal.sql)

> **`journal_entries`が削除されたら関係も消える**
> `ON DELETE CASCADE`により、`from_entry_id`・`to_entry_id`いずれかの仕訳が削除されると、その関係行も自動的に削除される。[1.5 仕訳の編集・削除](#15-仕訳の編集削除)の通り仕訳の物理削除は常に許可されるため、削除後に関係だけが宙に浮いた状態(存在しない仕訳を指す行)が残ることはない。

---

## 3. 仕訳の下書き(journal_entry_drafts)

### 3.1 位置づけ

マニュアル起票の途中入力(借方だけ入力して貸方が未入力、金額未確定等)をアプリ再起動を跨いで保持したいというニーズに応える、`journal_entries`とは別テーブルの保存領域である。

> **なぜ`journal_entries`に`is_draft`フラグを持たせないか**
> [1.3 貸借バランスの検証](#13-貸借バランスの検証)の通り、`journal_entries`への書き込みは「全明細行が揃った状態でRepository層がバランス検証を行う」ことが前提になっている。下書きは定義上バランスが崩れた状態(借方だけ入力済み等)や必須項目が空の状態を許容する必要がある。これを`journal_entries`側で許容すると、「入力経路によって整合性ルールが分岐しない」という[1.3](#13-貸借バランスの検証)の原則([architecture.md](../architecture.md) 12章由来)をis_draftという別軸の分岐で崩すことになる。そのため、バランス制約を一切課さない別テーブルとして持ち、確定操作の際に初めて通常の`JournalEntryRepository`を経由させ、そこで[1.3](#13-貸借バランスの検証)の検証を受けさせる。
>
> **なぜ定期取引の生成予定(先読み)をここに含めないか**
> [recurring-transactions.md 1.2](./recurring-transactions.md#12-自動生成-vs-レビュー確認)の提案は、ルールから都度計算される派生データであり、ユーザーが入力した永続化すべきWIPデータではない。これを`journal_entry_drafts`に保存してしまうと、ルール変更時の追従(再計算して差し替えるか、そのまま残すか)という同期の問題が生じる。これは[recurring-transactions.md 1.2](./recurring-transactions.md#12-自動生成-vs-レビュー確認)の「なぜ将来分をまとめて事前生成しないか」で一度却下した事前生成のリスクが別の形で再発することを意味する。定期取引の見通し表示は、表示のたびにルールから計算し直す(保存しない)方式とし、本テーブルとは無関係に扱う。

`purpose`カラムで用途を区別する。現時点では手入力仕訳の途中保存(`manual_entry`)のみを値として持つが、将来別の「途中保存したいWIPデータ」が増えた場合もこのテーブルにタグを追加する形で使い回す想定である。

### 3.2 ライフサイクル

| 操作 | 扱い |
|---|---|
| 作成 | ユーザーが仕訳入力フォームを開始した時点、または明示的な「下書き保存」操作で作成 |
| 更新 | フォームの内容が変わるたびに上書き保存(バランス等の検証は行わない) |
| 確定 | フォームの内容を`JournalEntryRepository`経由で`journal_entries`/`journal_lines`に変換する。[1.3](#13-貸借バランスの検証)のバランス検証を含む通常の作成経路をそのまま通るため、下書き段階の不整合はここで弾かれる。確定に成功したら下書き行(`journal_entry_drafts`および配下の`journal_entry_draft_lines`)は削除する |
| 破棄 | ユーザーの明示操作で削除。自動的な期限切れ・自動削除は設けない([1.6](#16-外部明細取込との関係)以下の他ドメインと同様、ユーザー操作に委ねる) |

### 3.3 フィールド定義

**journal_entry_drafts**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 下書きID | PK |
| `purpose` | 用途タグ | ENUM、現状`manual_entry`のみ([3.1](#31-位置づけ)参照) |
| `entry_date` | 取引日 | 任意。未入力の途中状態を許容するためNULL可 |
| `memo` | 摘要 | 任意 |
| `currency` | 通貨コード | 任意。未選択状態を許容するためNULL可([2.1](#21-フィールド定義)の`journal_entries.currency`と異なりNOT NULLにしない) |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**journal_entry_draft_lines**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 明細下書きID | PK |
| `journal_entry_draft_id` | 親下書きID | FK、親削除時CASCADE |
| `account_id` | 勘定科目ID | FK、任意。未選択状態を許容するためNULL可 |
| `project_id` | プロジェクトID | FK、任意 |
| `household_member_id` | 世帯メンバーID | FK、任意 |
| `counterparty_id` | 取引先ID | FK、任意。[2.1](#21-フィールド定義)の`journal_lines.counterparty_id`と異なり、下書き段階ではPL科目行への限定をTRIGGERで強制しない(確定時に`journal_lines`側のTRIGGERで検証される) |
| `side` | 借方/貸方 | ENUM: debit/credit、任意。未選択状態を許容するためNULL可 |
| `amount` | 金額 | 任意。未入力状態を許容するためNULL可、`journal_lines.amount`と異なり`amount > 0`のCHECKは課さない |
| `created_at` | 作成日時 | |

### 3.4 DDL

実装: [schema/journal.sql](../schema/journal.sql)
