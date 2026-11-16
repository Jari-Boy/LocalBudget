# 突合(Reconciliation)ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、外部明細との突合に関する詳細設計。

> **関連ドメイン**
> [architecture.md 12章](../architecture.md#12-起票方式外部明細取込マニュアル起票)の外部明細取込方針を具体化した[statement-import.md](./statement-import.md)([GitHub Issue #2](https://github.com/Jari-Boy/LocalBudget/issues/2))と密接に関わる。重複防止フローは[statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)側で定義され、本ファイルの残高照合([1.5](#15-残高照合))はそれと`external_transaction_refs`(突合マスタ、[2章](#2-突合マスタexternal_transaction_refs)参照)を共有する。
> 
> 暫定計上とその後の消込という会計処理パターンは[settlement.md](./settlement.md)として独立ドメイン化されている。

---

## 目次

1. [突合](#1-突合)
   - [1.1 位置づけ](#11-位置づけ)
   - [1.2 is_reconcilable資産・負債への記帳(直接記帳制限の廃止)](#12-is_reconcilable資産負債への直接記帳の制限)
   - [1.3 データモデルの考え方](#13-データモデルの考え方)
   - [1.4 ライフサイクル](#14-ライフサイクル)
   - [1.5 残高の基準点](#15-残高照合)
   - [1.6 基準点に合わせた自動調整仕訳](#16-原因不明差異への残高調整)
2. [突合マスタ(external_transaction_refs)](#2-突合マスタexternal_transaction_refs)
   - [2.1 フィールド定義](#21-フィールド定義)
   - [2.2 DDL](#22-ddl)
   - [2.3 他ドメインへの影響](#23-他ドメインへの影響)
   - [2.4 手で記録した残高(account_balance_records)](#24-手で記録した残高account_balance_records)

---

## 1. 突合

### 1.1 位置づけ

外部明細(CSV等)を取り込んで仕訳を作成する際、その明細と仕訳の対応関係を記録することを突合、必要に応じて帳簿残高が外部の実態と一致しているかを検証することを照合と呼ぶ。本ドメインはこの2つによって帳簿の正しさを保証する。突合と照合は対象範囲が異なるため、まず区別する。

> **用語: 突合と照合**
> 本ドメインでは両者を役割で使い分ける。**突合**は、外部明細(CSVの1行)と仕訳の対応関係を記録・維持する行為を指し、突合マスタ(`external_transaction_refs`、[2章](#2-突合マスタexternal_transaction_refs)参照)・重複防止([statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)参照、対応する記録が既にあるかを調べる)がこれにあたる。
> 
> **照合**は、突合によって記録された対応関係を土台に、値同士を比較検証する行為を指し、`is_reconcilable`(照合可否)・基準点との照合([1.5](#15-残高照合)・[1.6](#16-原因不明差異への残高調整)参照、帳簿残高と基準点の残高を日付ごとに比較し、ずれを自動調整仕訳にする)がこれにあたる。両者は同義語ではない。

**突合(重複防止、[statement-import.md 1.6](./statement-import.md#16-重複防止フロー))の対象**: 外部明細の取込対象として選ばれた科目であれば、`is_reconcilable`の値によらずすべて対象になる。現状は次の2種類。

- `asset`区分: 銀行口座・電子マネー・証券口座など、外部明細に残高情報がある資産([accounts.md 4.2](./accounts.md#42-外部明細と残高情報による照合可否の自動決定)参照)。
- `liability`区分: クレジットカード未払金科目([accounts.md 4.4 なぜカードごとに専用科目にするか](./accounts.md#44-なぜカードごとに専用科目にするか)参照、カードごとに1科目)。利用明細CSVを取り込む際の重複防止に使う。

**is_reconcilable(取引後残高の基準点[1.5](#15-残高照合))の対象**: 「自身の外部明細だけで残高が完結する科目」に限る。銀行口座・電子マネー・証券口座はこれに該当するが、クレジットカード未払金は該当しない。支払い(消込)の経路は口座振替に限らず、コンビニでの現金払いのように外部明細を伴わない経路もあるため、記帳経路を外部明細取込だけに限定できないからである([settlement.md](./settlement.md)、[accounts.md 4.5](./accounts.md#45-なぜis_reconcilable--falseにするか)参照)。将来、支払い経路が外部明細に限定される負債科目(カードローン等)が追加されれば、そちらは対象に含まれうる。

`is_reconcilable = false`の現金は同様に対象外([financial-statements.md 1.2 資産の照合可否](./financial-statements.md#12-資産の照合可否)の実残調整で扱う)。家賃等の暫定計上に使う汎用の未払金・未収金も対象外([settlement.md](./settlement.md)参照)。

本ドメインは、`is_reconcilable = true`の科目について、帳簿の乖離を**検知し、自動調整仕訳で解消する**(計画Issue #205)。

かつては記帳経路をCSV(+初期登録)に絞って乖離の入口を塞ぐ「予防」も併用していたが、計画Issue #145で廃止した([1.2](#12-is_reconcilable資産負債への直接記帳の制限)参照)。手入力や定期取引でも全科目を記帳できる代わりに、[1.5 残高の基準点](#15-残高照合)と帳簿残高を日付ごとに比較し、取り込み漏れ・事後編集・手入力との二重計上・手入力の誤りのいずれが原因でも、ずれた区間に自動調整仕訳が入り、その表示で気づけるようにする。クレジットカード未払金はこの検知の対象外だが、突合(重複防止)による保護は引き続き受けられる。

### 1.2 is_reconcilable資産・負債への記帳(直接記帳制限の廃止)

**`is_reconcilable = true`の科目(現状は銀行口座・電子マネー・証券口座等、[1.1](#11-位置づけ)参照)も、`source_type`([journal.md 1.7 作成経路(source_type)](./journal.md#17-作成経路source_type)参照)によらず記帳できる。** 手入力(`manual`)・定期取引生成(`recurring_generated`)・外部明細取込(`external_import`)・初期残高(`initial_balance`)・残高調整(`balance_adjustment`)のいずれの仕訳でも、`JournalEntryRepository`は科目の`is_reconcilable`を理由に作成・更新を拒否しない。手入力と定期取引ルールの科目選択肢から除外されるのは、無効化した科目だけである。

> **廃止した旧ルール(計画Issue #145)**
> 以前は`source_type`が`external_import`・`initial_balance`・`balance_adjustment`のいずれかである場合に限り`is_reconcilable = true`の科目への記帳を許可し、それ以外は`RestrictedAccountPostingError`で拒否していた。これは「帳簿残高が自分自身のCSVの累計と常に一致する」ことを構造的に保証するための制限だった。しかしユーザーは自由に起票できることを望み、確定後の仕訳編集を自由にしている[settlement.md](./settlement.md)・[1.4](#14-ライフサイクル)の考え方とも食い違っていたため、誤りを構造的に防ぐ方式から、警告で気づく方式へ変えた。システム管理科目(初期残高・残高調整)も同じ理由で手入力の選択肢から除外しない。判断の記録は[decisions.md](../decisions.md)の「手入力で全科目を選べるようにし、直接記帳制限を廃止する(計画Issue #145)」を参照。

**手入力とCSVの関係**: 手入力した取引をCSVでも取り込むと二重計上になりうるが、自動では防げない。次の2つで気づけるようにする。

- [statement-import.md 1.6](./statement-import.md#16-重複防止フロー)の「似た取引」(旧称: 確定版の可能性)の候補に、突合マスタを持たない仕訳(手入力・定期取引生成)も含める。CSV取込のアップロード時に、対象科目に明細がある手入力・定期取引生成の仕訳のうち突合マスタを持たないものを、日付が3日以内・金額が3%以内なら候補として提示する(`collectUnreferencedTransactions`)。初期残高・残高調整・割勘・外部明細取込の仕訳は候補にしない。
- [1.5 残高の基準点](#15-残高照合)と手入力行を含む全明細の帳簿残高を日付ごとに比較し、ズレを自動調整仕訳として残す。ただし基準点があるのは、取引後残高を持つCSVの科目と、残高を手で記録した科目に限られる。

`is_reconcilable`が`NULL`の区分(`equity`・`revenue`・`expense`)、および`is_reconcilable = false`の科目(現金、[settlement.md](./settlement.md)の暫定計上用の汎用未払金・未収金、CSVが取得できない口座)も従来どおり自由に手入力できる。これらは[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)の実残調整、または[settlement.md](./settlement.md)の暫定計上で運用する。クレジットカード未払金も、通常は外部明細取込(利用明細CSV)を主な記帳経路としつつ、コンビニ払い等CSVで捕捉できない支払いの手入力も許容する([accounts.md 4.5](./accounts.md#45-なぜis_reconcilable--falseにするか)参照)。

### 1.3 データモデルの考え方

CSVの1行(またはCSVから生成された仕訳)を「外部取引」として、そこから生成された`journal_entries`への参照を記録する。外部取引を一意に特定するキー(`external_id`)が取得できる金融機関はそれを使い、取得できない場合は日付・金額・摘要から生成した正規化ハッシュで代替する(具体的な正規化ハッシュのアルゴリズムと同一バッチ内完全一致レコードへの対応は[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)・[1.6](./statement-import.md#16-重複防止フロー)参照。[counterparties.md 1.3](./counterparties.md#13-外部明細取込との関係)の摘要正規化と同様の考え方)。

`journal_lines`ではなく仕訳ヘッダー単位で参照する。CSVの1行は通常1仕訳(入出金明細の片側+相手科目、または[settlement.md](./settlement.md)の消込仕訳)に対応するため、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)の「取引先はPL行単位」とは異なり、突合は仕訳ヘッダー単位で十分と考える。

### 1.4 ライフサイクル

- 仕訳(`journal_entries`)が削除された場合、対応する`external_transaction_refs`もCASCADE削除する。削除後に同じ内容で正しく再取込すれば復元できるため、内容が誤っていた場合の訂正手段として使える。
- 突合済み(=`external_transaction_refs`に存在する)仕訳の編集・削除は、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)、`is_reconcilable`の値によらず許可する。UI上で「外部明細との対応が崩れる」警告を出すに留め、DB・Repository層での禁止は行わない。
  - `external_transaction_refs`の存在が保証するのは「CSV由来として作成されたことがある」ことのみであり、「現在の内容がCSVの生データと一致し続けている」ことではない。
  - ただし`external_transaction_refs.entry_date`/`description`/`amount`([2.1](#21-フィールド定義)参照)にインポート時点の値が不変のまま残るため、これらのスナップショットと現在の`journal_entries`/`journal_lines`の値を比較すれば、崩れたかどうか・何が変わったかを判定できる。この比較を自動で行うか、UI上で都度突き合わせるだけに留めるかは実装課題とする。

### 1.5 残高の基準点

科目ごとに「日付 D の終わり時点の正しい残高」を**基準点**と呼ぶ。基準点と、帳簿残高(`entry_date <= D`の明細行の合計。[financial-statements.md 2.1](./financial-statements.md#21-生成方式)の一般式で、`asset`は`debit - credit`、`liability`は`credit - debit`)を、その日付ごとに比べる(計画Issue #205)。以前の「CSVの最後の行の残高と、科目の全期間・全日付の帳簿残高を比べる」方式は、時点の概念を持たないため、古いCSVを後から取り込むと偽陽性になる・新しい順のCSVで最後の行が最も古い残高になる・途中期間が抜けても原因が分からない、という問題があり、廃止した([decisions.md](../decisions.md)「残高の基準点に合わせた自動調整仕訳」参照)。

**基準点の出どころ**

| 科目 | 基準点 | 備考 |
|---|---|---|
| 取引後残高のあるCSVの科目(`is_reconcilable = true`) | 取り込んだ明細の各行の`external_balance_after`(その日の最後の行の値)と、取り込み開始直前の残高(最初の行の`external_balance_after - amount`、その前日の基準点) | 手で残高を記録する欄は出さない(CSVのみ) |
| それ以外の資産・負債(現金、残高列の無いCSVの科目、クレジットカード未払金) | 利用者が手で記録した残高(日付+金額、[2.4](#24-手で記録した残高account_balance_records)) | 記録しなければ何も起きない(従来どおり仕訳の合計が残高)。負債は向きを反転する(クレジットカードは請求額を記録する使い方) |

- **CSVの並び順と同じ日の複数行**: 取込時の行の順番を`external_transaction_refs.row_order`に持つ(既存データはid順で代用)。並び順(昇順/降順)は`balance_after[i] = balance_after[i-1] + amount[i]`が成り立つかで判定し(取込単位=`imported_at`ごと)、時系列で最後の行の残高をその日の基準点とする。実装: `resolveStatementAnchors`(`src/domain/reconciliation/`、純粋関数)。
- **古いCSV**: 帳簿は各基準点の日までで比べるため、CSV最終日より後の取引では偽陽性にならない。
- **締め日後の確定分などによる一時的なずれ**: +X/−Xの調整の組になるだけで許容する(月をまたぐとPLが月ごとに動く)。

### 1.6 基準点に合わせた自動調整仕訳

基準点の日に帳簿残高が基準点と一致するよう、ずれた区間ごとに**自動で調整仕訳を入れる**(計画Issue #205)。「差異を検出してもシステムは自動で調整仕訳を作らず、ユーザーが明示的に確定したときだけ作る」とした以前の方針(計画Issue #99の想定)は撤回した。自動調整仕訳は**計算で導出されるデータ**として常に計算し直されるため、後から明細を取り込んでも二重計上にならず、ずれた日・期間・金額が仕訳として残るので原因の特定もできるからである(判断の記録は[decisions.md](../decisions.md)参照)。

**あるべき自動調整の計算**(`planBalanceAnchorAdjustments`、純粋関数)

科目の基準点を日付順に並べ(同じ日は後ろに置いたものを採用)、次のように計画する。金額は「科目の残高が増える向きを正」とした符号付き。

- **最初の基準点(元手)**: その日の残高と、それ以前の明細(自動調整仕訳を除く)の合計との差額を、純資産「初期残高」(システム管理科目、[accounts.md 3.1](./accounts.md#31-フィールド定義))を相手科目とする仕訳で埋める。費用の「残高調整」で埋めると元手がPLに載ってしまうため。仕訳日は「一番古い基準点の日」と「その科目の一番古い仕訳の日」のうち早いほう(最初の記録より前の日付の仕訳が後から入っても、その期間の残高がマイナスに見えないように)。
- **2つ目以降**: 隣り合う基準点の間で「帳簿の増減」と「基準点の残高の増減」が食い違った区間ごとに、区間の終わりの日付で、費用のシステム管理科目「残高調整」を相手科目とする仕訳を1本入れる。これにより、どの基準点の日でも帳簿残高が基準点に一致し、PLの調整はずれが起きた期間に載る。
- **より古い基準点が現れたら**(古いCSVの取込・より前の日付の残高記録): 元手の役が移り、それまでの元手は普通の基準点になって、その差額は残高調整になる。
- 手入力で「残高調整」科目を使った仕訳は、普通の帳簿の行として計算に入る(特別扱いしない)。

**科目ごとの設定**: `accounts.auto_balance_adjustment`(初期値オン)。オンのとき上記を仕訳にする。オフのときは2つ目以降の調整は作らず、同じ計算結果を「ずれている日」として表示するだけにする。**オフでも元手(最初の基準点)の仕訳は作る**。全体設定のオン・オフは作らない。

**DBへの反映(計算し直し)**: 科目に関わる仕訳の作成・更新・削除(手入力・取込・定期仕訳・割勘・テンプレートのすべて)、取込の確定、残高の記録の追加・編集・削除、自動調整のオン・オフ・科目名の変更・科目の統合のたびに、**同じトランザクションの中で**Worker側が科目ごとに計算し直し、DB上の自動調整仕訳を「あるべき一覧」に合わせる(`reconcileAutoBalanceAdjustments`、`src/infrastructure/db/autoBalanceAdjustment.ts`)。作成経路が多く、画面側で呼ぶと呼び忘れるためRepository側に置く。内容(種別・日付・金額・摘要)が同じ仕訳は作り直さず残し、余りだけ削除・不足だけ追加する。

**自動調整仕訳の扱い**

- `source_type`は`auto_balance_adjustment`([journal.md 1.7](./journal.md#17-作成経路source_type))。導出データなので、**利用者は編集・削除・関連付けできない**(`JournalEntryRepository`の更新・削除は`AutoBalanceAdjustmentEntryReadOnlyError`で拒否する。id は計算し直しで変わりうる)。
- 摘要は元手が「初期残高(科目名)」、調整が「残高の自動調整(科目名 MM/DD〜MM/DD)」。期間は「ひとつ前の基準点の翌日〜この基準点の日」で、計算し直しで期間が変われば摘要も変わる。
- 仕訳一覧には「自動調整」の出どころタグで表示し、出どころで絞り込める。詳細パネルは読み取り専用で、自動で作られた仕訳であること・ずれた期間と内容と、その期間の仕訳・科目の照合への導線を出す。
- 科目の右パネルの「残高の照合」欄(勘定科目マスタ、[accounts.md 5.4](./accounts.md#54-マスタ画面の勘定科目タブ計画issue-154))に、基準点ごとの表(日付・ずれた期間・明細/記録した残高・調整前の帳簿・自動調整)と、自動調整の合計(初期残高を除く)を出す。
- 明細取込画面では、確定前に「取り込むとどの期間にいくらの自動調整が入るか」を知らせる(`previewImportReconciliation`)。調整はオフの科目では入らない旨を伝える。

**限界**: 誤り(二重計上・入力ミス)も自動で吸収されるため、利用者が気づけるよう、仕訳一覧のタグと照合欄の表・合計に表示を頼る。

---

## 2. 突合マスタ(external_transaction_refs)

### 2.1 フィールド定義

| カラム                      | 内容         | 制約・備考                                                                                                                                                                 |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | ID         | PK                                                                                                                                                                    |
| `account_id`             | 対象口座/対象カード | FK。外部明細の取込対象として選択された科目を指す([1.1](#11-位置づけ)参照)。`is_reconcilable`の値によらず設定されうる(`asset`の銀行口座等、または`liability`のクレジットカード未払金、[accounts.md 4章](./accounts.md#4-資産負債収益費用の統合登録フロー計画issue-102)参照) |
| `journal_entry_id`       | 対応する仕訳     | FK、親削除時CASCADE                                                                                                                                                        |
| `external_id`            | 外部取引の一意キー  | 金融機関側のトランザクションIDまたは正規化ハッシュ                                                                                                                                            |
| `entry_date`             | 取引日(スナップショット) | インポート時点で`ImportedRecord.entry_date`([statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)参照)から複写。書き込み後は不変 |
| `description`            | 摘要(スナップショット) | インポート時点で`ImportedRecord.description`から複写した生文字列。書き込み後は不変。`journal_entries.memo`の初期値としても使われるが、`memo`はその後ユーザーが自由に上書きできるのに対しこちらは不変 |
| `amount`                 | 金額(スナップショット) | インポート時点で`ImportedRecord.amount`から複写した符号付き整数(正 = 対象科目の残高が増える方向、[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)参照)。`journal_lines.amount`/`side`に変換される前の、CSV自身の符号表現のまま保持する。書き込み後は不変 |
| `external_balance_after` | 取引後残高      | 任意。CSVに残高列がある場合のみ格納。基準点になる([1.5](#15-残高照合)参照)                                                                                                                                |
| `row_order`              | 取込時のCSV上の行の順番 | 任意(既存データはNULLでid順で代用、計画Issue #205)。0始まり。同じ日の複数行の「最後の残高」とCSVの並び順の判定に使う([1.5](#15-残高照合)) |
| `is_settled`             | 確定済みか      | 任意(NULL許容)。[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)の`ImportedRecord.is_settled`をそのまま引き継ぐ。確定版候補のサジェスト([statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー))にのみ使い、FS集計には関与しない           |
| `imported_at`            | 取込日時       |                                                                                                                                                                       |

同一口座内で`external_id`は重複登録できない(重複防止の要)。

> **なぜ`account_id`にTRIGGER制約を設けないか**
> 以前は`is_reconcilable = true`の科目のみを許可するTRIGGERを設けていたが、これは不要な制約だった。`external_transaction_refs`は「外部明細の取込対象としてユーザーが選んだ科目」に対して、パーサーを通過した明細を突き合わせた結果として機械的に作られるレコードである。この仕組みは、対象科目が`is_reconcilable = true`かどうかとは無関係に成立する([1.1 用語: 突合と照合](#11-位置づけ)参照)。取込対象として選べる科目自体は、勘定科目の統合登録フロー([accounts.md 4章](./accounts.md#4-資産負債収益費用の統合登録フロー計画issue-102)参照)によって`asset`または`liability`の実在する外部口座・カードに自然と絞られるため、DB側で重ねて制約する必要はない。

> **なぜ`entry_date`/`description`/`amount`のコピーを持つか**
> `journal_entries`/`journal_lines`は[1.4 ライフサイクル](#14-ライフサイクル)の通り事後編集を許可されており、`entry_date`・`memo`・`amount`はユーザーが後から自由に書き換えられる。一方この3列は、インポートされた瞬間の値を固定して保持する。両者を突き合わせて初めて「CSVは本来こう言っていたのに、今の仕訳はこう変わっている」という具体的な比較ができる。CSVファイル自体は再取込しない限りアプリの外にあるため、この複写がなければ、一度確定した後は「元々CSVが何と言っていたか」をアプリ内で確認する手段が失われる。[1.6 原因不明差異への残高調整](#16-原因不明差異への残高調整)の調査や、[journal.md 1.5](./journal.md#15-仕訳の編集削除)がUI警告に留めている「外部明細との対応が崩れる」を、CSVの再アップロードなしに具体的に(どの値がどう変わったか)提示できるようにするのが狙い。

### 2.2 DDL

実装: [schema/reconciliation.sql](../schema/reconciliation.sql)

### 2.3 他ドメインへの影響

`journal_entries`・`journal_lines`へのカラム追加は不要(FKは`external_transaction_refs`側が持つ)。ただし以下の点は他ドメインの反映が必要。

- `JournalEntryRepository`(仕訳ドメイン、[journal.md](./journal.md))は仕訳作成時に`journal_entries.source_type`([journal.md 1.7](./journal.md#17-作成経路source_type)参照)を適切に設定する。[1.2](#12-is_reconcilable資産負債への直接記帳の制限)の通り、`is_reconcilable = true`の科目への記帳を`source_type`で拒否することはしない(計画Issue #145で廃止)。割勘の精算仕訳の場合は、未収金・未払金(精算バッチ)の行に`settlement_batch_id`タグを付与し、タグ集計方式([settlement.md](./settlement.md)参照)でどの割勘バッチの精算かを表現する責務も持つ(カード未払金などそれ以外の一時勘定の消込にはタグを付けない、計画Issue #167)。
- 重複防止(突合)の実装は[statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)側の責務であり、`is_reconcilable`の値によらない独立した処理として`JournalEntryRepository`が`external_transaction_refs`を作成する([2.1](#21-フィールド定義)「なぜ`account_id`にTRIGGER制約を設けないか」参照)。
- [1.4](#14-ライフサイクル)の突合済み仕訳の編集・削除ルールは[GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)(仕訳自体のライフサイクル設計)で決着し、[journal.md 1.5](./journal.md#15-仕訳の編集削除)に反映済み。
- [1.6](#16-原因不明差異への残高調整)の費用の「残高調整」科目・純資産の「初期残高」科目はどちらもシステム管理科目で、Worker起動時に`seedBalanceAdjustmentAccount`・`seedInitialBalanceAccount`が冪等に投入する([accounts.md 3.1](./accounts.md#31-フィールド定義))。
- `external_transaction_refs.is_settled`は[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)の`ImportedRecord.is_settled`の値をそのまま引き継ぐ。設定するのは[statement-import.md 2章](./statement-import.md#2-マッピング定義マスタimport_mapping_definitions)のマッピング定義であり、本ドメイン側では値の判定ロジックを持たない。

### 2.4 手で記録した残高(account_balance_records)

取引後残高のあるCSVの科目以外の資産・負債が、基準点を手で記録するためのテーブル(計画Issue #205)。1行が「日付`record_date`の終わり時点の正しい残高`balance`」を表し、同じ科目・同じ日は1件だけ(一意制約)。科目を削除すると一緒に消える(`ON DELETE CASCADE`)。追加・編集・削除のたびに、同じトランザクションで科目の自動調整仕訳を計算し直す([1.6](#16-原因不明差異への残高調整))。取引後残高のあるCSVの科目には記録欄を出さない。実装: [schema/reconciliation.sql](../schema/reconciliation.sql)、`SqlJsAccountBalanceRecordRepository`。
