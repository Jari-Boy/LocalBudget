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
   - [1.8 関連仕訳グループ(journal_entry_link_groups)](#18-関連仕訳グループjournal_entry_link_groups)
2. [仕訳マスタ(journal_entries・journal_lines)](#2-仕訳マスタjournal_entriesjournal_lines)
   - [2.1 フィールド定義](#21-フィールド定義)
   - [2.2 DDL](#22-ddl)
   - [2.3 関連仕訳グループマスタ(journal_entry_link_groups)](#23-関連仕訳グループマスタjournal_entry_link_groups)
3. [仕訳の下書き(journal_entry_drafts)](#3-仕訳の下書きjournal_entry_drafts)
   - [3.1 位置づけ](#31-位置づけ)
   - [3.2 ライフサイクル](#32-ライフサイクル)
   - [3.3 フィールド定義](#33-フィールド定義)
   - [3.4 DDL](#34-ddl)

---

## 1. 仕訳ドメイン

### 1.1 仕訳(JournalEntry)と仕訳明細(JournalLine)

取引は「仕訳(JournalEntry)」という単位で記録される。仕訳は日付・摘要を持つヘッダーであり、実際の金額の増減は子レコードである「仕訳明細(JournalLine)」に記録される。1件の仕訳は2件以上の仕訳明細から成り、その合計金額は借方・貸方で必ず一致する(複式簿記の恒等式)。

仕訳ヘッダーは、この仕訳を切った主体を表す「起票者」(`household_member_id`、NOT NULL)を持つ(計画Issue #88)。起票者は仕訳明細の`household_member_id`(明細の上書き、[household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)参照)とは役割が異なり、明細行の世帯メンバーを書き込み時に決めるときの既定値(科目に既定メンバーが無く、行で指定もされない場合の値)として使われる。読み取り側が起票者へフォールバックすることはない(明細行は常に実際の世帯メンバーを持つ、計画Issue #169)。仕訳画面で起票者を選択・変更でき、変更すると旧起票者のままで科目に既定メンバーがない明細行だけが追従する([household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)参照)。

仕訳明細は勘定科目に加えて、任意でプロジェクト([projects.md 1章](./projects.md#1-プロジェクト))・世帯メンバー([household-members.md 1章](./household-members.md#1-世帯メンバー))を紐づけられる。

| 概念           | 役割                                         | 例                          |
| ------------ | ------------------------------------------ | -------------------------- |
| JournalEntry | 1つの取引のヘッダー。日付・摘要・起票者                       | 「2026-07-20 スーパーで食材購入(起票者: 夫)」     |
| JournalLine  | 仕訳を構成する各行。勘定科目・金額・借方/貸方・(任意で)プロジェクト・世帯メンバー | 「(借)食費 3,000」「(貸)現金 3,000」 |

最もシンプルな仕訳は2行(借方1行・貸方1行)である。1つの支払いを複数の費目にまたがって計上する複合仕訳では3行以上になる。

```
例: 1万円をカードで買い物し、食費7,000円・日用品費3,000円に分けて計上する

(借) 費用・食費        7,000
(借) 費用・日用品費    3,000
(貸) 負債・未払金             10,000
```

仕訳明細の借方/貸方は、金額を表す`amount`(常に正の整数)と、借方/貸方を表す`side`(`debit`/`credit`)の2列で表現する。1行=1エントリとして扱えるため、口座残高やFSの集計クエリを「`side`に応じて符号を反転して合算する」という単一のロジックで一貫して書ける(詳細は[financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式))。

> **仕訳の複数軸絞り込み(JournalEntryFilter、計画Issue #40)**
> 期間(`entry_date`の範囲)・科目・世帯メンバー(明細行の`household_member_id`との比較、[household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)参照)・プロジェクトをANDで組み合わせて仕訳を絞り込む共通の型`JournalEntryFilter`と、これを適用する純粋関数`filterJournalEntries`(`src/domain/journal/`)を持つ。いずれかの明細行が条件に一致すればその仕訳(entry単位)を候補に含める(財務諸表の[financial-statements.md](./financial-statements.md)の`FinancialStatementFilter`とは型・粒度が異なる別物)。計画Issue #145で条件を拡張した(下記)。割勘対象選択画面([expense-splitting.md 1.5](./expense-splitting.md#15-割勘の履歴と取り消し)参照)を含む複数画面の絞り込みUIから再利用される共通のドメイン関数として設計されている。詳細は`docs/decisions.md`(2026-08-15)参照。

> **検索条件の拡張(計画Issue #145)**
> `JournalEntryFilter`に次の条件を追加した。検索の画面と共通部品はUI刷新のIssueで扱い、ここはドメイン側だけである。保存した検索条件は作らない。
>
> | 条件 | 内容 |
> |---|---|
> | `memo` | 摘要の部分一致(英字は大文字小文字を区別しない。空白だけは絞り込みなし) |
> | `amountMin`・`amountMax` | 仕訳の金額の範囲(両端を含む)。仕訳の金額は**借方の合計**(貸借が一致するので貸方の合計と同じ) |
> | `accountIds`・`householdMemberIds`・`projectIds`・`counterpartyIds` | 複数選択。いずれかに一致すればよい(OR)。従来の単一指定(`accountId`等)は互換のため残し、同じ軸で両方を指定すると両方を満たす仕訳だけを返す |
> | `settlementBatchIds` | 精算バッチ。数値はそのバッチのタグが付いた明細行を持つ仕訳、`null`は**未割当**(精算バッチのタグが付いた明細行が仕訳内に1行も無い)。複数指定はOR |
> | `sourceTypes` | 作成経路([1.7](#17-作成経路source_type))。割勘(`expense_splitting`)を含む |
> | `accountGroupIds`・`counterpartyGroupIds`・`projectGroupIds` | グループ指定。指定したグループと配下(入れ子を含む)のグループに属する科目・取引先・プロジェクトを含む仕訳を対象にする。展開は`expandGroupIds`で、グループ・取引先・プロジェクトのマスタは`filterJournalEntries`の第4引数(`JournalEntryFilterContext`)で渡す(科目は第2引数のaccountsの`account_group_id`を使う) |
>
> **判定は仕訳全体で行う**: 軸の間はAND、軸の内側(複数選択)はOR。各軸は仕訳内のどの明細行で満たしてもよく、複数の軸を別々の明細行で満たしてもヒットする(例: クレジットカードの行と食費の行を持つ仕訳が「楽天カードで払った食費」にヒットする)。空配列は絞り込みなしとして扱う。
>
> **精算の候補だけは固定条件を別に持つ**: 精算画面(精算タブ)の「消込む仕訳を選ぶ」候補(`findUnassignedAdvanceEntriesForTarget`)は、「対象の立替金科目かつ対象者」を**同じ明細行**で満たし、精算バッチが未設定の行を持つ仕訳に限る。この固定条件は仕訳全体の検索条件では置き換えられないため、`filterJournalEntries`で先に仕訳を絞り込んだうえで(省略可の`search`引数)、行単位の固定条件を重ねる。精算の候補と関連仕訳の追加は従来から`filterJournalEntries`を使っておらず、今回も関連仕訳の追加には手を入れていない(既存の挙動を崩さないため)。
>
> 既存の仕訳一覧と割勘の対象選択は、従来の単一指定のまま動作が変わらない。

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

> **is_reconcilable資産への記帳**
> 「普通預金」のような`is_reconcilable = true`の資産科目も、`source_type`によらず手入力で記帳できる(計画Issue #145で直接記帳制限を廃止、[reconciliation.md 1.2](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限))。手入力とCSVのズレは[reconciliation.md 1.5 残高照合](./reconciliation.md#15-残高照合)の警告で検知する。「給与が振り込まれる」の例はCSV到着時にその場で記帳するケースを表す。CSV到着前に先に記帳したい場合は「給与を先に見込み計上」のように未収金・未払金を経由した暫定計上を行い、CSV到着後にそれを消し込む([settlement.md](./settlement.md)参照)。

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
- 仕訳画面の「明細行単位」表示(計画Issue #182): 仕訳一覧タブには「仕訳単位 / 明細行単位」の表示方式の切替があり、明細行単位では借方の行を左・貸方の行を右に行番号で対応づけた表(`JournalLineTable`)で、行を押すとその仕訳の全行がインライン編集になる(編集の単位は仕訳で、同時に1仕訳だけ)。明細行を仕訳をまたいで選び、科目・プロジェクト・取引先・精算バッチ・世帯メンバーをまとめて変える一括編集もある(金額・日付・貸借は対象外)。科目変更時の取引先・精算バッチ・世帯メンバーの扱いは`applyAccountChange`に共通化され、既存の不変条件は変わらない。詳細は`docs/decisions.md`の2026-11-12の項を参照。
- 仕訳画面(`JournalScreen`、計画Issue #169)の編集操作: (1)詳細パネルの「起票者」はセレクトで、変更すると旧起票者のままで科目に既定メンバーがない明細行だけが追従する([household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方))。(2)「保存して続けて入力」ボタンは新規仕訳にだけ出し、既存仕訳の編集画面には出さない。(3)仕訳の削除ボタンは詳細の最下部の「仕訳の削除」セクションにあり、赤い塗りのボタンを2回押して確定する(精算タブのバッチ削除と同じ形式)。(4)未保存の変更があるまま移動しようとすると「キャンセル／破棄して移動／保存して移動」のダイアログを出す。対象はサイドナビ・領域タブ、画面内の別の仕訳/タブ/新規への切り替え、割勘への移動、関連仕訳を開く操作。リロードやタブを閉じるときはブラウザ標準の確認を出す。ブラウザの戻るボタンは対象外(HashRouterは`useBlocker`を使えないため、`AppShell`のリンクを`GuardedLink`にしてコンテキストのガードを通している)。

**物理削除は常に許可する**([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)。反対仕訳を挟むことは強制しない。日常的な訂正では関連仕訳グループを作らず、物理削除・直接編集のみで完結させる。

**`JournalEntryRepository.deleteByProjectId(projectId)`で、あるプロジェクト([projects.md 1章](./projects.md#1-プロジェクト))にタグ付けされた仕訳をまとめて物理削除できる**([GitHub Issue #52](https://github.com/Jari-Boy/LocalBudget/issues/52)で決着)。誤って投入した割勘バッチ([expense-splitting.md 1.2 一時勘定(立替金/未払金)](./expense-splitting.md#12-一時勘定立替金未払金)参照、割勘バッチは立替金行にタグ付けられた`project_id`で識別される)を1件ずつ`delete(id)`で消す代わりに、対象`project_id`が`journal_lines.project_id`にタグ付けされた`journal_entries`を一括で取り消せる。`SqlJsJournalEntryRepository`の実装は、単一のDBトランザクション(BEGIN〜COMMIT)内で対象仕訳をまとめてDELETEするall-or-nothing方式であり、`journal_lines`・`journal_entry_link_group_memberships`への波及は既存の`ON DELETE CASCADE`([2.3](#23-関連仕訳グループマスタjournal_entry_link_groups))にすべて委ねる。上記の「物理削除は常に許可する」方針をそのまま踏襲するため、削除対象に精算済み仕訳が混在していてもガードしない。対象`project_id`を持つ仕訳が0件の場合は何もせず正常終了する([expense-splitting.md 1.5 割勘の履歴と取り消し](./expense-splitting.md#15-割勘の履歴と取り消し)も参照)。

[accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」は反対仕訳([1.8](#18-関連仕訳グループjournal_entry_link_groups)の`reverses`)で扱う。これは科目マスタ側の大量の過去仕訳を一括付け替えする特殊な操作の文脈である。1件の仕訳を日常的に編集・削除する場面にまで同じ重さを求めると、入力ミスの訂正が煩雑になり、[domain.md 1.1 基本方針](../domain.md#11-基本方針)の「会計知識のない一般ユーザーにも使える」という方針に反する。[1.8](#18-関連仕訳グループjournal_entry_link_groups)の通り、フィールド単位の変更履歴(何をいつ変更したか)は引き続き持たない。

**`source_type = 'external_import'`の仕訳(外部明細取込由来)も、`is_reconcilable`資産側の`account_id`/`amount`/`side`や`entry_date`を含め編集を許可する**(Issue #1で決着)。ただし編集すると、対応する`external_transaction_refs`が指す元のCSV明細との対応が崩れるため、UI上で警告する。[reconciliation.md 1.2](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限)の「CSV由来のみ許可」はあくまで**作成経路(`source_type`)**の制約であり、事後の内容がCSVの生データと一致し続けることまでは保証しない。内容が誤っていた場合、削除して正しい内容で再取込する([reconciliation.md 1.4](./reconciliation.md#14-ライフサイクル)参照)か、その場で編集するかはユーザーの選択に委ねる。

### 1.6 外部明細取込との関係

外部明細取込時の相手勘定科目の自動推定は、取引先マスタを介したサジェスト機能として[counterparties.md 1章](./counterparties.md#1-取引先)で定義する。本章で定義した仕訳・仕訳明細のデータモデルと貸借バランス検証は、外部明細取込経由・マニュアル起票経由のいずれからも共通して使われる土台として位置づける([architecture.md](../architecture.md) 12章の方針の通り)。

### 1.7 作成経路(source_type)

`journal_entries`は、どのような経路で作られたかを`source_type`として持つ。

| 値 | 意味 |
|---|---|
| `manual` | 手入力(既定値) |
| `external_import` | 外部明細取込のレビュー確定を経て作成された。通常の取引・消込のどちらも含む |
| `recurring_generated` | 定期仕訳([recurring-transactions.md](./recurring-transactions.md))の提案をレビュー確認(承認)して作成された。ルールの行(2行でも3行以上でも)が仕訳の明細行になり、ルールの行に精算バッチが設定されていれば、立替金・未払金の行にそのバッチのタグが付く(計画Issue #180)。起票者はルール単位、行の世帯メンバーは 科目の既定 > 行 > 起票者 の順で決まる |
| `initial_balance` | 口座/カード開設時の初期残高仕訳([accounts.md 4.3 初期残高の自動仕訳](./accounts.md#43-初期残高の自動仕訳)) |
| `balance_adjustment` | 残高調整([reconciliation.md 1.6](./reconciliation.md#16-原因不明差異への残高調整)、[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)) |
| `expense_splitting` | 割勘機能で作った仕訳([expense-splitting.md](./expense-splitting.md)、計画Issue #149)。割勘かどうかは科目構成ではなくこの値で判定する。精算の仕訳は分類を増やさず、口座明細からなら`external_import`、手で起票したものなら`manual`とする |

`source_type`は仕訳の作成経路を表す。以前は[reconciliation.md 1.2](./reconciliation.md#12-is_reconcilable資産負債への直接記帳の制限)が「この仕訳はis_reconcilable = trueの科目に記帳してよいか」を判定する根拠にしていたが、計画Issue #145でその制限を廃止したため、現在は一覧の出どころ表示など、経路を区別する用途に使う。

> **なぜ`external_transaction_refs`の存在ではなく`source_type`で判定したか(旧ルールの経緯)**
> 以前は「is_reconcilable = trueの科目を使う行に対応する`external_transaction_refs`があるか」を根拠にしていたが、これは「作成経路(この仕訳はどうやって生まれたか)」と「外部データとの突合材料(この科目の残高は外部の何と一致するはずか)」という別々の関心事を1つのテーブルに同居させていた。両者が食い違うケース(初期残高・残高調整の仕訳のように、is_reconcilable = true科目を使う仕訳でも対応する外部CSV行が存在しない場合等)で無理が生じていた。`source_type`は前者(作成経路)だけを担い、`external_transaction_refs`([reconciliation.md 2章](./reconciliation.md#2-突合マスタexternal_transaction_refs)参照)は後者(突合材料)だけを担うことで関心事を分離する。仕訳が複数のis_reconcilable = true科目にまたがる場合(口座間振替等)も、仕訳単位の`source_type`が1回チェックされるだけで済み、行ごとに参照の有無を確認する必要がない。

### 1.8 関連仕訳グループ(journal_entry_link_groups)

消込・按分といった残高計算・消込判定(複式簿記の整合性検証、[1.3](#13-貸借バランスの検証))は、`settlement_batch_id`タグの集計方式([settlement.md](./settlement.md)参照)が全面的に担う。一方で「ある仕訳に関連する他の仕訳をユーザーが一覧表示できる」という表示専用の役割は、**関連仕訳グループ**(`journal_entry_link_groups`、[2.3](#23-関連仕訳グループマスタjournal_entry_link_groups)参照)という多対多のグルーピングで表現する(計画Issue #138)。

> **経緯(journal_entry_linksからの置き換え)**
> 以前は明細行(JournalLine)単位の`journal_entry_links`(`settles`/`allocates`の2種、計画Issue #132)が、残高計算・消込検証・関連仕訳の表示を兼ねていた。残高計算・消込検証の役割は計画Issue #133で`settlement_batch_id`タグの集計方式に完全移管され、表示専用の役割だけが残っていた。計画Issue #138で、この表示専用の役割のためだけに行対行の厳密な検証(科目一致・貸借逆・金額上限)を伴う重いテーブルを維持する必要はないと判断し、`journal_entry_links`テーブル自体・関連する検証コード(`JournalEntryLinkLineError`等)・`JournalEntryDetailScreen`のリンク削除警告UI(2段階ボタン確認フロー)を完全に撤廃した。設計判断の経緯(単一FK方式・自己参照FK方式を検討して却下した理由)は`docs/decisions.md`(2026-11-02)参照。

- 関連仕訳グループは**仕訳(JournalEntry)単位**の関連付けであり、明細行単位ではない。`link_type`(種別タグ)は持たず、「関連している」という緩い関係のみを表す。
- 1つの仕訳が複数のグループに同時に所属できる(所属数の上限なし)。これにより、例えば1つの口座引き落とし仕訳(精算仕訳)が、無関係な2つの異なる精算バッチ(それぞれ別のグループ)の両方を同時に消し込むようなケースでも、精算仕訳がその2つのグループへそれぞれ参加するだけで表現でき、無関係な2つのグループ自体が意図せず統合されることはない。
- 用途は表示専用。仕訳画面(`JournalScreen`)の詳細パネルの最下部に「関連仕訳」として、所属するグループごとに一覧表示するためだけに使う(計画Issue #152。以前はボタン起点のダイアログ`RelatedEntriesDialog`だった)。残高計算・消込判定には一切関与しない。
- 作成契機: 割勘([expense-splitting.md](./expense-splitting.md)参照)の仕訳を作成する際は、システムが自動的にグループを作成・参加させ、関連する仕訳(元仕訳・割勘仕訳・精算仕訳)を同じグループに所属させる。それ以外のケースでは、ユーザーが仕訳画面の関連仕訳から、絞り込みポップアップで既存の仕訳を選んで手動で関連付け、グループを作成・参加させる。
- グループへの参加/新規作成の判定は、ドメイン層の純粋関数`planJoinOrCreateGroups`(`src/domain/journal-link-group/`)が担う。anchorEntryIds(既存の仕訳群)の既存グループを調べ、1つも無ければanchor・newEntryIdsをまとめた新規グループを作成し、1つ以上あればそれら全てのグループへnewEntryIdsを参加させる(anchor自身は既存グループへ追加しない)。`JournalEntryLinkGroupRepository.joinOrCreateGroups`がこの判定に従ってDB書き込みを行う単一のエントリポイントであり、割勘の自動グルーピング(`ExpenseSplittingForm`・`SettlementScreen`)・仕訳画面からの手動関連付けの両方から使われる。
- メンバーが0件になったグループ(全メンバーの仕訳が削除された等)は、DBトリガー(`journal_entry_link_groups_delete_when_empty`、[2.3](#23-関連仕訳グループマスタjournal_entry_link_groups)参照)により自動的に削除される。ユーザーが仕訳画面の関連仕訳から手動で関連付けを解除する操作(`JournalEntryLinkGroupRepository.removeMember`)も同じ経路で、残りが1件になった場合はトリガーが発火せずグループ自体は残る(表示側は自分以外のメンバーが0件のグループを表示しないため、UI上は見えなくなる)。
- 関連仕訳の追加には2つの入口がある(計画Issue #152)。通常の追加は`joinOrCreateGroups`の判定に従い、この仕訳が既存グループに所属していればそこへ合流する。「+ 新しいグループ」ボタンは既存グループに合流せず、`JournalEntryLinkGroupRepository.createGroup`で、この仕訳と選んだ仕訳による新しいグループを作る(既に別グループに所属していても関係を分けて持ちたい場合のため)。
- ユーザーが関連仕訳の各行から任意の仕訳をグループから除外できる(「解除」ボタン)(確認ダイアログは置かない。journal_entry_links撤廃時に廃止したリンク削除警告UIと同じ方針、残高計算に関与しない緩い関連付けの解除に重い確認は不要と判断)。
- ユーザーが関連仕訳の各行を、別の既存グループへ、または新規グループへ移動できる(`JournalEntryLinkGroupRepository.moveMember`、除外+参加/新規作成を1トランザクションで実行)。操作は各行の移動先セレクトから行う(計画Issue #152で、ドラッグ&ドロップと、移動によりグループが見えなくなるときの警告は引き継いでいない。decisions.md参照)。
- 表示(`RelatedEntriesSection`)は、1つの仕訳が複数の無関係なグループに同時に所属する場合(上記の精算仕訳の例)でも、全グループ分を1本のフラットな一覧に合算しない。`groupRelatedEntriesByLinkGroup`(`src/domain/journal-link-group/`)でグループ単位の塊に分けたまま渡し、どの仕訳がどのグループの関連かが見分けられるようにする(UIレビューでの指摘「多対多のグルーピングをUIが表現できていない」への対応)。各グループの表示名(`name`)はこの欄の入力欄でその場編集でき(`JournalEntryLinkGroupRepository.renameGroup`)、未設定時はUI側で「グループN」(N=そのグループidの昇順での順序)を表示する。グループ数はユーザーの明示的な操作(手動関連付け・新規の割勘/精算起票)がない限り増えない(`planJoinOrCreateGroups`の判定上、既存グループに所属するanchorへの追加操作は新規グループを作らず既存グループへの参加にとどまる)。

> **仕訳削除時のON DELETE CASCADE**
> `journal_entry_link_group_memberships`の`journal_entry_id`は`journal_entries`への`ON DELETE CASCADE`であるため、仕訳が物理削除されると、その仕訳の所属行だけが削除される(他の仕訳の所属には影響しない)。[1.5 仕訳の編集・削除](#15-仕訳の編集削除)の「編集・削除は常に可能」方針をそのまま踏襲し、これを妨げるロックは設けない。journal_entry_links時代にあった保存前の警告UI(`findLinkedLinesToRemove`)は、関連仕訳グループが仕訳単位(明細行単位ではない)の緩い関連付けであり、仕訳の更新操作で明細行が削除されてもグループ所属には影響しないため、前提自体が成立せず廃止した。

> **監査ログ(誰が・いつ・何を変更したか)とは別物**
> [1.5 仕訳の編集・削除](#15-仕訳の編集削除)の通り、フィールド単位の変更履歴(何をいつ変更したか)は持たない。関連仕訳グループが記録するのは「独立した仕訳同士がどう関連するか」であり、1件の仕訳自体の編集履歴ではない。
>
> **`reverses`(反対仕訳)は持たない**
> 以前は科目統合([accounts.md 2.1](./accounts.md#21-操作ルール)の「別科目への実質変更」)のために反対仕訳+再計上という方式を想定していたが、これは仕訳件数が最大3倍に膨らむ割に、家計簿アプリの利用者層には監査証跡としての価値が薄いと判断した。科目統合・取引先統合は直接UPDATE+操作ログ([accounts.md 2.2](./accounts.md#22-過去仕訳の付け替え)・[counterparties.md 1.5](./counterparties.md#15-ライフサイクル)参照)に置き換え、`reverses`の唯一の用途が消滅したため設計から削除した。厳密な反対仕訳による訂正をしたいユーザーは、通常の手入力仕訳として自分で管理すればよい。

---

## 2. 仕訳マスタ(journal_entries・journal_lines)

### 2.1 フィールド定義

**journal_entries**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 仕訳ID | PK |
| `entry_date` | 取引日 | `YYYY-MM-DD` |
| `memo` | 摘要 | 任意。「何の取引か」を表す |
| `comment` | コメント | 任意。摘要とは役割を分けた自由な補足(計画Issue #144)。仕訳ごとに1つで履歴は持たない。更新時は未指定なら既存を維持し、`null`で消去する(`UpdateJournalEntryInput.comment`) |
| `currency` | 通貨コード | ISO 4217、MVPでは`JPY`固定 |
| `source_type` | 作成経路 | ENUM、既定`manual`([1.7 作成経路(source_type)](#17-作成経路source_type)参照) |
| `household_member_id` | 起票者 | FK、NOT NULL。この仕訳を切った主体([household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)参照、計画Issue #88) |
| `generated_from_rule_id` | 生成元の定期仕訳ルール | FK、任意。`source_type = 'recurring_generated'`の仕訳でのみ値を持ち、手入力・外部明細取込由来の仕訳では`NULL`。参照のみで複式簿記の整合性検証には関与しない([recurring-transactions.md 1.5](./recurring-transactions.md#15-生成された仕訳との関係)参照、計画Issue #121) |
| `recurring_due_date` | 土日の調整前の期日 | YYYY-MM-DD、任意。定期仕訳から生成した仕訳にだけ値を持ち、手入力・外部明細取込由来の仕訳では`NULL`。`entry_date`は仕訳の編集や土日の調整で動くため、定期仕訳の提案の起点はこの列で求める。`(generated_from_rule_id, recurring_due_date)`に一意制約があり、同じルール・同じ期日の二重生成を防ぐ([recurring-transactions.md 1.2](./recurring-transactions.md#12-自動生成-vs-レビュー確認)・[2.1](./recurring-transactions.md#21-フィールド定義)参照、計画Issue #164) |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**journal_lines**

| カラム                   | 内容            | 制約・備考                                                                           |
| --------------------- | ------------- | ------------------------------------------------------------------------------- |
| `id`                  | 明細ID          | PK                                                                              |
| `journal_entry_id`    | 親仕訳ID         | FK、親削除時はCASCADE                                                                 |
| `account_id`          | 勘定科目ID        | FK                                                                              |
| `project_id`          | プロジェクトID      | FK、任意。全区分の行に設定可([projects.md 1.2](./projects.md#12-紐づけ対象)参照)              |
| `household_member_id` | 世帯メンバーID | FK、NOT NULL(計画Issue #169)。全区分で設定可。常に実際の世帯メンバーを持ち、NULL(継承)は無い。書き込み時は科目の既定メンバー > 指定 > 起票者の順で決める(`resolveLineHouseholdMemberId`)。科目(`accounts.household_member_id`)に既定値がある場合、その値と異なる値は設定できない(TRIGGERで強制)。読み取り側は科目既定値や起票者へフォールバックせず、この値をそのまま使う([household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)参照) |
| `counterparty_id`     | 取引先ID         | FK、任意。PL科目(revenue/expense)の行にのみ設定可(TRIGGERで強制、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)参照)              |
| `side`                | 借方/貸方         | ENUM: debit/credit                                                              |
| `amount`              | 金額            | 通貨最小単位の正の整数                                                                     |
| `created_at`          | 作成日時          |                                                                                 |

> **`comment`と`memo`の違い(計画Issue #144)**
> `memo`(摘要)は「何の取引か」を表す取引の要約であり、明細取込では取込元の`description`が初期値になる。`comment`はそれとは別に、ユーザーが仕訳ごとに残せる自由な補足(理由・経緯など)である。履歴は持たず、上書きで更新する。手入力フォーム・下書き・仕訳詳細の更新・明細取込のレビュー確定の各経路で保存・表示できる。
>
> **`journal_lines.settlement_batch_id`は一時勘定の行にのみ設定できる(計画Issue #144)**
> 割勘の一時勘定(システム管理の立替金・未払金)の行以外にはタグを設定できない(計画Issue #167で、`is_reconcilable = false`の資産・負債科目から絞り込んだ)。ドメイン判定`isSettlementBatchTaggableAccount`と専用エラー`SettlementBatchOnNonAdvanceAccountError`を使い、`JournalEntryRepository`のcreate/updateが書き込み前に検証する([settlement.md 1.7](./settlement.md#17-タグ付き一時勘定の消込settlement_batch_idによるタグ付け)参照)。仕訳画面では精算バッチ欄を立替金・未払金の行にだけ出し、タグ付きの行の科目をそれ以外へ変えると欄と一緒にタグも外す(立替金⇔未払金の変更ではタグを維持する。[settlement.md 1.8](./settlement.md#18-タグの編集について)参照)。
>
> 明細行自体には`updated_at`を持たせない。明細の変更は「仕訳ヘッダー配下の行構成をまるごと差し替える」操作としてRepository層が扱い、変更の痕跡は親である`journal_entries.updated_at`側に集約する([1.5](#15-仕訳の編集削除)参照)。
>
> **`journal_lines.id`は更新時に行ごとの差分更新で維持される(計画Issue #132)**
> `JournalEntryRepository.update`は、入力行が持つ`id`を既存行と対応付け、該当する既存行はUPDATE(idを維持)、`id`を持たない入力行はINSERT(新規採番)、入力に含まれなかった既存行はDELETEする差分更新である。関連仕訳グループ(計画Issue #138)は仕訳単位の関連付けであり明細行のidには依存しないため、この差分更新で行idが変わっても(あるいは行が削除されても)グループ所属には影響しない。

### 2.2 DDL

実装: [schema/journal.sql](../schema/journal.sql)

> **貸借バランスはDBで強制しない**
> [1.3]の通り、DBでは強制しない。この検証は`JournalEntryRepository`が担う。

> **科目の既定値がある明細行への異なる世帯メンバーの指定はDBトリガーで拒否する**
> [household-members.md 1.2](./household-members.md#12-紐づけ対象と明細行の世帯メンバーの決め方)の通り、科目(`accounts.household_member_id`)に既定値がある場合、その科目を使う`journal_lines.household_member_id`は科目の既定値と異なる値を明示指定できない(`prevent_household_member_override_on_default_account_line_insert`/`_update`トリガー、`counterparty_id`のPL科目限定制約と同じINSERT/UPDATE両対応のTRIGGERパターン)。INSERTは科目の既定値と異なる値を拒否する。UPDATEは`household_member_id`を変えない限り許可し(科目の既定メンバーを変えて過去の行を旧メンバーのまま残したとき、その行の金額等を編集できるように)、変える場合だけ科目の既定値との一致を検証する。`journal_lines.household_member_id`自体はNOT NULLで、開発用DBは作り直す前提のためマイグレーションは行わない(NULL許容の旧スキーマのバックアップの取込は対象外、取込時のスキーマ検証が`InvalidBackupFileError`で拒否する、計画Issue #169)。

### 2.3 関連仕訳グループマスタ(journal_entry_link_groups)

[1.8 関連仕訳グループ](#18-関連仕訳グループjournal_entry_link_groups)の通り、仕訳同士の緩い関連付けを多対多で記録する(計画Issue #138)。

**フィールド定義**

**journal_entry_link_groups**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ID | PK |
| `name` | 表示名 | NULL可(ユーザーが任意で設定、未設定時はUI側で「グループN」等の既定名を表示する。この既定名自体はDBに保存しない) |
| `created_at` | 作成日時 | |

**journal_entry_link_group_memberships**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ID | PK |
| `link_group_id` | 所属するグループ | FK(`journal_entry_link_groups.id`)、親削除時CASCADE |
| `journal_entry_id` | 所属する仕訳 | FK(`journal_entries.id`)、親削除時CASCADE |
| `created_at` | 作成日時 | |

`(link_group_id, journal_entry_id)`にUNIQUE制約を課し、同じ仕訳が同じグループに重複して所属することを防ぐ。

**DDL**

実装: [schema/journal.sql](../schema/journal.sql)

> **仕訳が削除されたら所属行も消え、メンバー0件のグループは自動的に削除される**
> `journal_entry_link_group_memberships`の`journal_entry_id`は`journal_entries`への`ON DELETE CASCADE`であるため、仕訳が物理削除されると、その仕訳の所属行だけが削除される(他の仕訳の所属には影響しない)。さらに、ある`link_group_id`の所属行が1件も残らなくなった時点で、トリガー(`journal_entry_link_groups_delete_when_empty`)が`journal_entry_link_groups`側の該当行も削除する。これにより、全メンバーが削除されたグループが孤立したまま残り続けることはない([1.8](#18-関連仕訳グループjournal_entry_link_groups)の懸念点「グループに所属する仕訳が0件になった場合の後始末」への対応)。

---

## 3. 仕訳の下書き(journal_entry_drafts)

### 3.1 位置づけ

マニュアル起票の途中入力(借方だけ入力して貸方が未入力、金額未確定等)をアプリ再起動を跨いで保持したいというニーズに応える、`journal_entries`とは別テーブルの保存領域である。

> **なぜ`journal_entries`に`is_draft`フラグを持たせないか**
> [1.3 貸借バランスの検証](#13-貸借バランスの検証)の通り、`journal_entries`への書き込みは「全明細行が揃った状態でRepository層がバランス検証を行う」ことが前提になっている。下書きは定義上バランスが崩れた状態(借方だけ入力済み等)や必須項目が空の状態を許容する必要がある。これを`journal_entries`側で許容すると、「入力経路によって整合性ルールが分岐しない」という[1.3](#13-貸借バランスの検証)の原則([architecture.md](../architecture.md) 12章由来)をis_draftという別軸の分岐で崩すことになる。そのため、バランス制約を一切課さない別テーブルとして持ち、確定操作の際に初めて通常の`JournalEntryRepository`を経由させ、そこで[1.3](#13-貸借バランスの検証)の検証を受けさせる。
>
> **なぜ定期仕訳の生成予定(先読み)をここに含めないか**
> [recurring-transactions.md 1.2](./recurring-transactions.md#12-自動生成-vs-レビュー確認)の提案は、ルールから都度計算される派生データであり、ユーザーが入力した永続化すべきWIPデータではない。これを`journal_entry_drafts`に保存してしまうと、ルール変更時の追従(再計算して差し替えるか、そのまま残すか)という同期の問題が生じる。これは[recurring-transactions.md 1.2](./recurring-transactions.md#12-自動生成-vs-レビュー確認)の「なぜ将来分をまとめて事前生成しないか」で一度却下した事前生成のリスクが別の形で再発することを意味する。定期仕訳の見通し表示は、表示のたびにルールから計算し直す(保存しない)方式とし、本テーブルとは無関係に扱う。

`purpose`カラムで用途を区別する。現時点では手入力仕訳の途中保存(`manual_entry`)のみを値として持つが、将来別の「途中保存したいWIPデータ」が増えた場合もこのテーブルにタグを追加する形で使い回す想定である。

### 3.2 ライフサイクル

| 操作 | 扱い |
|---|---|
| 作成 | ユーザーが仕訳入力フォームを開始した時点、または明示的な「下書き保存」操作で作成 |
| 更新 | フォームの内容が変わるたびに上書き保存(バランス等の検証は行わない) |
| 確定 | フォームの内容を`JournalEntryRepository`経由で`journal_entries`/`journal_lines`に変換する。[1.3](#13-貸借バランスの検証)のバランス検証を含む通常の作成経路をそのまま通るため、下書き段階の不整合はここで弾かれる。確定に成功したら下書き行(`journal_entry_drafts`および配下の`journal_entry_draft_lines`)は削除する |
| 破棄 | ユーザーの明示操作で削除。自動的な期限切れ・自動削除は設けない([1.6](#16-外部明細取込との関係)以下の他ドメインと同様、ユーザー操作に委ねる) |

> **「開始した時点」とは、フォームの表示(マウント)ではなくユーザーが最初に入力した時点を指す**
> 旧`JournalEntryForm`(Issue #32、マニュアル起票UI)の実装では、フォームを表示しただけでは下書きを作成せず、日付・摘要・明細行のいずれかを最初に変更した時点で(デバウンス自動保存経由で)初めて`journal_entry_drafts`へ作成していた。計画Issue #152で仕訳画面(`JournalScreen`)に統合してからは自動保存をやめ、利用者が「下書きに保存」「下書きを保存」を押したときだけ下書きを作成・更新する。フォームを開いただけで何も入力せず離脱する操作のたびに空の下書きが蓄積することを避けるための実装判断であり、本節冒頭の「開始した時点」はこの意味で解釈する。詳細は`docs/decisions.md`参照。
>
> **確定時、末尾に残る未入力の明細行は送信対象から自動的に除外される(計画Issue #125)**
> 旧`JournalEntryLinesTable`(借方/貸方ブロック共通のLinesテーブルUI)は、各ブロックの末尾に常に1行の空行(未入力)を自動的に保持していた(計画Issue #152で`JournalEntryEditor`に置き換え、行追加は「+ 借方/貸方の行を追加」ボタンに戻した)。このため下書きには、ユーザーが実際に入力した行に加えて、まだ何も入力されていない末尾の空行が常に含まれる。`SqlJsJournalEntryDraftRepository.confirm`は、科目・貸借・正の金額のいずれかが未入力の明細行(`isCompleteDraftLine`で判定)を`JournalEntryRepository.create`への送信直前に除外し、この自動保持分の空行が「明細数不足」等のエラーとして扱われないようにする。詳細は`docs/decisions.md`参照。

### 3.3 フィールド定義

**journal_entry_drafts**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 下書きID | PK |
| `purpose` | 用途タグ | ENUM、現状`manual_entry`のみ([3.1](#31-位置づけ)参照) |
| `entry_date` | 取引日 | 任意。未入力の途中状態を許容するためNULL可 |
| `memo` | 摘要 | 任意 |
| `comment` | コメント | 任意。`journal_entries.comment`に対応し、自動保存・復元・確定時にそのまま引き継ぐ(計画Issue #144) |
| `currency` | 通貨コード | 任意。未選択状態を許容するためNULL可([2.1](#21-フィールド定義)の`journal_entries.currency`と異なりNOT NULLにしない) |
| `household_member_id` | 起票者 | FK、任意。[2.1](#21-フィールド定義)の`journal_entries.household_member_id`と異なりNOT NULLにしない(下書き段階では未入力を許容、計画Issue #88)。確定時にNULLのままだと`journal_entries`側のNOT NULL制約により確定操作(3.2)が失敗する |
| `created_at` | 作成日時 | |
| `updated_at` | 更新日時 | |

**journal_entry_draft_lines**

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | 明細下書きID | PK |
| `journal_entry_draft_id` | 親下書きID | FK、親削除時CASCADE |
| `account_id` | 勘定科目ID | FK、任意。未選択状態を許容するためNULL可 |
| `project_id` | プロジェクトID | FK、任意 |
| `household_member_id` | 世帯メンバーID | FK、任意。NULL許容のまま(下書き段階の未入力を許容)。確定時に世帯メンバーのない明細行があれば`JournalLineHouseholdMemberRequiredError`で確定を拒否する(計画Issue #169)。下書きを再開したときは、未入力の世帯メンバーを科目の既定メンバー、無ければ起票者で補う |
| `counterparty_id` | 取引先ID | FK、任意。[2.1](#21-フィールド定義)の`journal_lines.counterparty_id`と異なり、下書き段階ではPL科目行への限定をTRIGGERで強制しない(確定時に`journal_lines`側のTRIGGERで検証される) |
| `side` | 借方/貸方 | ENUM: debit/credit、任意。未選択状態を許容するためNULL可 |
| `amount` | 金額 | 任意。未入力状態を許容するためNULL可、`journal_lines.amount`と異なり`amount > 0`のCHECKは課さない |
| `created_at` | 作成日時 | |

### 3.4 DDL

実装: [schema/journal.sql](../schema/journal.sql)
