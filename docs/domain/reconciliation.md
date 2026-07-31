# 突合(Reconciliation)ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、外部明細との突合(Reconciliation)に関する詳細設計。

> **関連ドメイン**
> [architecture.md 12章](../architecture.md#12-起票方式外部明細取込マニュアル起票)の外部明細取込方針を具体化した[statement-import.md](./statement-import.md)([GitHub Issue #2](https://github.com/Jari-Boy/LocalBudget/issues/2))と密接に関わる。重複防止フローは[statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)側で定義され、本ファイルの記帳経路制限([1.2](#12-is_reconcilable資産負債への直接記帳の制限))・残高照合([1.5](#15-残高照合))はそれと`external_transaction_refs`(突合マスタ、[2章](#2-突合マスタexternal_transaction_refs)参照)を共有する。CSV到着前の暫定記帳とその後の消込という会計処理パターンは[settlement.md](./settlement.md)として独立ドメイン化されている。

---

## 目次

1. [突合](#1-突合)
   - [1.1 位置づけ](#11-位置づけ)
   - [1.2 is_reconcilable資産・負債への直接記帳の制限](#12-is_reconcilable資産負債への直接記帳の制限)
   - [1.3 データモデルの考え方](#13-データモデルの考え方)
   - [1.4 ライフサイクル](#14-ライフサイクル)
   - [1.5 残高照合](#15-残高照合)
   - [1.6 原因不明差異への残高調整](#16-原因不明差異への残高調整)
2. [突合マスタ(external_transaction_refs)](#2-突合マスタexternal_transaction_refs)
   - [2.1 フィールド定義](#21-フィールド定義)
   - [2.2 DDL](#22-ddl)
   - [2.3 他ドメインへの影響](#23-他ドメインへの影響)

---

## 1. 突合

### 1.1 位置づけ

外部明細(CSV等)を取り込んで仕訳を作成する際、その明細と仕訳の対応関係を記録し(突合)、必要に応じて帳簿残高が外部の実態と一致しているかを検証する(照合)ことで、帳簿の正しさを保証するのが本ドメインの役割。突合と照合は対象範囲が異なるため、まず区別する。

> **用語: 突合と照合**
> 本ドメインでは両者を役割で使い分ける。**突合**は、外部明細(CSVの1行)と仕訳の対応関係を記録・維持する行為を指し、突合マスタ(`external_transaction_refs`、[2章](#2-突合マスタexternal_transaction_refs)参照)・重複防止([statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)参照、対応する記録が既にあるかを調べる)がこれにあたる。**照合**は、突合によって記録された対応関係を土台に、値同士を比較検証する行為を指し、`is_reconcilable`(照合可否)・残高照合([1.5](#15-残高照合)参照、帳簿残高と外部残高を比較する)がこれにあたる。照合は突合の上に成り立つ検証行為であり、両者は同義語ではない。

**突合(重複防止、[statement-import.md 1.6](./statement-import.md#16-重複防止フロー))の対象**: 外部明細の取込対象として選ばれた科目であれば、`is_reconcilable`の値によらずすべて対象になる。現状は次の2種類。

- `asset`区分: 銀行口座・電子マネー・証券口座([accounts.md 4.2](./accounts.md#42-種類選択による照合可否の自動決定)参照)
- `liability`区分: クレジットカードのカード専用未払金科目([accounts.md 5章 クレジットカード登録のUX](./accounts.md#5-クレジットカード登録のux)参照、カードごとに1科目)。利用明細CSVを取り込む際の重複防止に使う

**is_reconcilable(記帳経路制限[1.2](#12-is_reconcilable資産負債への直接記帳の制限)・残高照合[1.5](#15-残高照合))の対象**: 「自身の外部明細だけで残高が完結する科目」に限る。銀行口座・電子マネー・証券口座はこれに該当するが、クレジットカードの未払金は該当しない。支払い(消込)の経路は口座振替に限らず、コンビニでの現金払いのように外部明細を伴わない経路もあるため、記帳経路を外部明細取込だけに限定できないからである([settlement.md](./settlement.md)、[accounts.md 5.3](./accounts.md#53-なぜis_reconcilable--falseにするか)参照)。将来、支払い経路が外部明細に限定される負債科目(カードローン等)が追加されれば、そちらは対象に含まれうる。

`is_reconcilable = false`の現金は同様に対象外([financial-statements.md 1.2 資産の照合可否](./financial-statements.md#12-資産の照合可否)の実残調整で扱う)。家賃等の暫定計上に使う汎用の未払金・未収金も対象外([settlement.md](./settlement.md)参照)。

本ドメインは「予防」と「検知」の二段構えで、`is_reconcilable = true`の科目について帳簿の正しさを保証する。

1. **予防**: [1.2](#12-is_reconcilable資産負債への直接記帳の制限)の記帳経路制限により、そもそもズレが起こりにくい記帳経路に限定する。CSV以外の経路(手入力・仕訳の自由な削除等)を無制限に許せば帳簿はいつでも外部の正と乖離しうるが、記帳経路をCSV(+初期登録)に絞ることで乖離の入口を塞ぐ。
2. **検知**: しかし[1.4 ライフサイクル](#14-ライフサイクル)の通り、突合済み仕訳の事後編集・削除はUI警告のみで許可されているため、予防だけでは乖離を防ぎきれない。[1.5 残高照合](#15-残高照合)で帳簿残高と外部残高を直接比較し、取り込み漏れ・事後編集のどちらが原因でも乖離を検知する。

どちらか一方ではなく、この2つが揃って初めて「突合」の名にふさわしい保証になる。クレジットカードの未払金はこの二段構えの対象外だが、突合(重複防止)による保護は引き続き受けられる。

### 1.2 is_reconcilable資産・負債への直接記帳の制限

**`is_reconcilable = true`の科目(現状は銀行口座・電子マネー・証券口座等、自身の外部明細だけで残高が完結する資産科目、[1.1](#11-位置づけ)参照)を借方/貸方に使う仕訳明細は、その仕訳の`source_type`([journal.md 1.7 作成経路(source_type)](./journal.md#17-作成経路source_type)参照)が以下のいずれかである場合のみ作成できる。**

- `external_import`: 外部明細取込のレビュー確定を経て作成された(通常の取引・消込のどちらも含む、[settlement.md](./settlement.md)参照)
- `initial_balance`: 口座開設時の初期残高仕訳([accounts.md 4.3](./accounts.md#43-初期残高の自動仕訳))。システムによる一度きりのセットアップ操作
- `balance_adjustment`: 残高調整([1.6](#16-原因不明差異への残高調整))

`manual`(手入力)・`recurring_generated`(定期取引生成、[recurring-transactions.md](./recurring-transactions.md)参照)はこのホワイトリストに含まれないため、is_reconcilable = trueの科目を直接使う仕訳を作成できない。

このルールにより、銀行口座・電子マネー・証券口座の残高は、常にこのホワイトリストに含まれる作成経路の仕訳のみで構成される。ユーザーが手入力で直接これらの科目を使ったり、仕訳を自由に削除・改変したりすることで残高が実態と乖離する、という事態が構造的に起こらなくなる。「作成経路が正当」であることは、対象科目が自身の外部明細だけで残高が完結する([1.1](#11-位置づけ)参照)ことと合わさって初めて、「帳簿残高が自分自身のCSVの累計と常に一致する」という強い保証になる。この2つが揃わない科目(クレジットカード未払金等)には、このルールそのものを適用しない([1.1](#11-位置づけ)参照)。

> **なぜDBのTRIGGERで強制しないか**
> `source_type`は仕訳ヘッダー(`journal_entries`)自身の列であり、明細行(`journal_lines`)がINSERTされる時点で既に確定している。そのため、[journal.md 1.3 貸借バランスの検証](./journal.md#13-貸借バランスの検証)がTRIGGER不採用の理由に挙げた「BEFORE INSERT時点では関連レコードがまだ存在しない」という制約はここでは当てはまらず、技術的にはTRIGGERでも実装可能である。それでもRepository層で強制するのは、`UnbalancedJournalEntryError`等の他のドメインエラーと一貫したエラー体験(具体的なメッセージ、アプリケーション例外としての扱い)を保つためであり、DB側の`RAISE(ABORT)`よりもRepository層での明示的な検証の方が、このアプリの一貫方針([journal.md 1.3](./journal.md#13-貸借バランスの検証)、[statement-import.md 3章](./statement-import.md#3-責務分担)参照)に沿う。`JournalEntryRepository`は仕訳を作成する際、明細の科目が`is_reconcilable = true`であるにもかかわらずヘッダーの`source_type`がホワイトリスト外である場合、仕訳の作成を拒否する。

`is_reconcilable`が`NULL`の区分(`equity`・`revenue`・`expense`)、および`is_reconcilable = false`の科目(現金、[settlement.md](./settlement.md)の暫定計上用の汎用未払金・未収金、CSVが取得できない口座)はこのルールの対象外であり、従来どおり自由に手入力できる(`source_type = 'manual'`)。これらは[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)の実残調整、または[settlement.md](./settlement.md)の暫定計上・消込で運用する。クレジットカード未払金も`is_reconcilable = false`のためこのルールの対象外だが、通常は外部明細取込(利用明細CSV)を主な記帳経路としつつ、コンビニ払い等CSVで捕捉できない支払いの手入力も許容する([accounts.md 5.3](./accounts.md#53-なぜis_reconcilable--falseにするか)参照)。

### 1.3 データモデルの考え方

CSVの1行(またはCSVから生成された仕訳)を「外部取引」として、そこから生成された`journal_entries`への参照を記録する。外部取引を一意に特定するキー(`external_id`)が取得できる金融機関はそれを使い、取得できない場合は日付・金額・摘要から生成した正規化ハッシュで代替する(具体的な正規化ロジックは[statement-import.md](./statement-import.md)側の実装課題、[counterparties.md 1.3](./counterparties.md#13-外部明細取込との関係)の摘要正規化と同様の考え方)。

`journal_lines`ではなく仕訳ヘッダー単位で参照する。CSVの1行は通常1仕訳(入出金明細の片側+相手科目、または[settlement.md](./settlement.md)の消込仕訳)に対応するため、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)の「取引先はPL行単位」とは異なり、突合は仕訳ヘッダー単位で十分と考える。

### 1.4 ライフサイクル

- 仕訳(`journal_entries`)が削除された場合、対応する`external_transaction_refs`もCASCADE削除する。削除後に同じ内容で正しく再取込すれば復元できるため、内容が誤っていた場合の訂正手段として使える。
- 突合済み(=`external_transaction_refs`に存在する)仕訳の編集・削除は、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)、`is_reconcilable`の値によらず許可する。UI上で「外部明細との対応が崩れる」警告を出すに留め、DB・Repository層での禁止は行わない。
  - `external_transaction_refs`の存在が保証するのは「CSV由来として作成されたことがある」ことのみであり、「現在の内容がCSVの生データと一致し続けている」ことではない。
  - ただし`external_transaction_refs.entry_date`/`description`/`amount`([2.1](#21-フィールド定義)参照)にインポート時点の値が不変のまま残るため、これらのスナップショットと現在の`journal_entries`/`journal_lines`の値を比較すれば、崩れたかどうか・何が変わったかを判定できる。この比較を自動で行うか、UI上で都度突き合わせるだけに留めるかは実装課題とする。

### 1.5 残高照合

CSVに取引後残高が含まれる金融機関では、`external_balance_after`を記録しておく([2.1](#21-フィールド定義)参照)。新しいCSVを取り込む際、レビュー確定の直前に以下のフローで帳簿残高と外部残高を照合する。

**対象科目**: `is_reconcilable = true`の科目([1.1](#11-位置づけ)参照)に限る。現状は銀行口座・電子マネー・証券口座が該当する。クレジットカード未払金は`is_reconcilable = false`のため対象外であり、その正しさの検知は消込に使われた資金の出どころである口座側の残高照合、および[settlement.md](./settlement.md)側の記帳(利用明細CSVの重複防止)に委ねる。

1. この新しいCSVの内容を仮に反映したとして、対象口座の帳簿残高を計算する。該当科目の`journal_lines`のうち、**対応する`external_transaction_refs`を持つ行、または`journal_entries.source_type`が`initial_balance`・`balance_adjustment`である行**(確定済みの過去分+今回取り込む分の草案)を、[financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式)の残高計算の一般式(`asset`は`debit - credit`、`liability`は`credit - debit`)で積み上げる
2. 新しいCSVの最後の行が示す`external_balance_after`(外部残高)を取得する
3. 1と2が一致しなければ、レビュー画面で「◯月◯日時点の残高が一致しません」のように警告する
4. 警告は取り込みを止めるものではない(既定で取り込みは許可する)

**絞り込み条件の理由**

対象科目は残高の増減が常に自分自身のCSV1本に由来するため、`external_transaction_refs`を持つ行だけでも本来は積み上げとして十分なはずである。それでも`source_type`が`initial_balance`・`balance_adjustment`の行も含めるのは、この2つは[1.2](#12-is_reconcilable資産負債への直接記帳の制限)のホワイトリストにより`is_reconcilable = true`科目への記帳が許されているにもかかわらず、CSV由来ではないため`external_transaction_refs`が作られないからである。この2つを積み上げから除外してしまうと、口座開設時の初期残高や[1.6 原因不明差異への残高調整](#16-原因不明差異への残高調整)で生成した調整仕訳が恒久的に計算から漏れ、外部残高と一致しない状態が解消不能になる。対象科目は増減が自分自身のCSV1本(+初期残高・残高調整)に由来し、その全行がいずれかの条件を満たすため、この絞り込みは実質的に「全journal_lines」と同じ結果になる。

**乖離の原因**

3で乖離が見つかる原因は主に2つある。

- **取り込み漏れ**: 該当期間のCSV明細が一度も取り込まれていない。該当期間のCSVを別途再取込することが正規の解消フローになる
- **事後編集・削除**: [1.4 ライフサイクル](#14-ライフサイクル)の通り、突合済み仕訳の編集・削除はUI警告のみで許可されているため、過去に正しく取り込んだ仕訳が後から変更され、帳簿残高が動いた

警告メッセージからはどちらが原因かを特定できない(症状としては同じ「帳簿残高 ≠ 外部残高」で現れるため)。ユーザーが原因を特定できない、あるいは特定してもなお解消しない場合は、[1.6 原因不明差異への残高調整](#16-原因不明差異への残高調整)で対応する。

> **なぜ毎回全期間を積み上げ直すか**
> 「前回チェック時点からの差分だけ」を検証する方式では、前回チェックより前の期間で発生した事後編集(2つ目の原因)を見逃す。全期間を都度積み上げる方式なら、原因を問わずどの時点の乖離も検知できる。個人の家計簿規模の取引件数であれば、都度SUMする計算コストは無視できる。

**CSVに残高列がない場合**

CSVに残高列がない金融機関ではこの検証自体ができず、乖離があっても気づけないリスクが残る(CSVフォーマットの限界であり、ドメイン側では解決できない)。

### 1.6 原因不明差異への残高調整

[1.5 残高照合](#15-残高照合)の警告を受けて対応しても、なお解消しない差異が残ることがある(該当期間のCSVがそもそも取得不能、銀行側の処理タイミングのズレ、原因となった事後編集を特定できない等)。この場合、[financial-statements.md 1.2 資産の照合可否](./financial-statements.md#12-資産の照合可否)の現金の実残調整と同じ発想で、**ユーザーが「これ以上原因を追わず差額を確定する」ことを明示的に選んだときのみ**、システム管理科目「費用・残高調整」を相手科目とする調整仕訳を生成する。差異を検出した時点でシステムが自動生成することはしない([architecture.md 12章](../architecture.md#12-起票方式外部明細取込マニュアル起票)の「レビューを経てから確定する」という一貫方針との整合による)。

「残高調整」は現金の実残調整で使う科目と共通化する([financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)参照)。トリガーとなる操作(現金は実残の手入力、`is_reconcilable = true`の科目はCSV残高との比較)が違うだけで、「帳簿と外部の正との差異を吸収する費用科目」という会計処理上の構造は同じであるため。

---

## 2. 突合マスタ(external_transaction_refs)

### 2.1 フィールド定義

| カラム                      | 内容         | 制約・備考                                                                                                                                                                 |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | ID         | PK                                                                                                                                                                    |
| `account_id`             | 対象口座/対象カード | FK。外部明細の取込対象として選択された科目を指す([1.1](#11-位置づけ)参照)。`is_reconcilable`の値によらず設定されうる(`asset`の銀行口座等、または`liability`のクレジットカード専用未払金、[accounts.md 5章](./accounts.md#5-クレジットカード登録のux)参照) |
| `journal_entry_id`       | 対応する仕訳     | FK、親削除時CASCADE                                                                                                                                                        |
| `external_id`            | 外部取引の一意キー  | 金融機関側のトランザクションIDまたは正規化ハッシュ                                                                                                                                            |
| `entry_date`             | 取引日(スナップショット) | インポート時点で`ImportedRecord.entry_date`([statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)参照)から複写。書き込み後は不変 |
| `description`            | 摘要(スナップショット) | インポート時点で`ImportedRecord.description`から複写した生文字列。書き込み後は不変。`journal_entries.memo`の初期値としても使われるが、`memo`はその後ユーザーが自由に上書きできるのに対しこちらは不変 |
| `amount`                 | 金額(スナップショット) | インポート時点で`ImportedRecord.amount`から複写した符号付き整数(正 = 対象科目の残高が増える方向、[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)参照)。`journal_lines.amount`/`side`に変換される前の、CSV自身の符号表現のまま保持する。書き込み後は不変 |
| `external_balance_after` | 取引後残高      | 任意。CSVに残高列がある場合のみ格納([1.5](#15-残高照合)参照)                                                                                                                                |
| `is_settled`             | 確定済みか      | 任意(NULL許容)。[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)の`ImportedRecord.is_settled`をそのまま引き継ぐ。確定版候補のサジェスト([statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー))にのみ使い、FS集計には関与しない           |
| `imported_at`            | 取込日時       |                                                                                                                                                                       |

同一口座内で`external_id`は重複登録できない(重複防止の要)。

> **なぜ`account_id`にTRIGGER制約を設けないか**
> 以前は`is_reconcilable = true`の科目のみを許可するTRIGGERを設けていたが、これは不要な制約だった。`external_transaction_refs`は「外部明細の取込対象としてユーザーが選んだ科目」に対して、パーサーを通過した明細を突き合わせた結果として機械的に作られるレコードであり、対象科目が`is_reconcilable = true`かどうかとは無関係に成立する仕組みである([1.1 用語: 突合と照合](#11-位置づけ)参照)。取込対象として選べる科目自体は、口座登録・クレジットカード登録の各ウィザード([accounts.md 4章](./accounts.md#4-口座登録のux)・[5章](./accounts.md#5-クレジットカード登録のux)参照)によって`asset`または`liability`の実在する外部口座・カードに自然と絞られるため、DB側で重ねて制約する必要はない。

> **なぜ`entry_date`/`description`/`amount`のコピーを持つか**
> `journal_entries`/`journal_lines`は[1.4 ライフサイクル](#14-ライフサイクル)の通り事後編集を許可されており、`entry_date`・`memo`・`amount`はユーザーが後から自由に書き換えられる。一方この3列は、インポートされた瞬間の値を固定して保持する。両者を突き合わせて初めて「CSVは本来こう言っていたのに、今の仕訳はこう変わっている」という具体的な比較ができる。CSVファイル自体は再取込しない限りアプリの外にあるため、この複写がなければ、一度確定した後は「元々CSVが何と言っていたか」をアプリ内で確認する手段が失われる。[1.6 原因不明差異への残高調整](#16-原因不明差異への残高調整)の調査や、[journal.md 1.5](./journal.md#15-仕訳の編集削除)がUI警告に留めている「外部明細との対応が崩れる」を、CSVの再アップロードなしに具体的に(どの値がどう変わったか)提示できるようにするのが狙い。

### 2.2 DDL

実装: [schema/reconciliation.sql](../schema/reconciliation.sql)

### 2.3 他ドメインへの影響

`journal_entries`・`journal_lines`へのカラム追加は不要(FKは`external_transaction_refs`側が持つ)。ただし以下の点は他ドメインの反映が必要。

- [1.2](#12-is_reconcilable資産負債への直接記帳の制限)の記帳経路制限は`JournalEntryRepository`(仕訳ドメイン、[journal.md](./journal.md))の実装要件になる。仕訳作成時に`journal_entries.source_type`([journal.md 1.7](./journal.md#17-作成経路source_type)参照)を適切に設定し、明細の科目が`is_reconcilable = true`であるにもかかわらず`source_type`がホワイトリスト外である場合は作成を拒否する。消込仕訳の場合は、あわせて`journal_entry_links`(`link_type = 'settles'`、[journal.md 1.8](./journal.md#18-仕訳間の関係journal_entry_links)参照)を作成し、元の利用明細仕訳との対応関係を記録する責務も持つ([settlement.md](./settlement.md)参照)。
- 重複防止(突合)の実装は[statement-import.md 1.6 重複防止フロー](./statement-import.md#16-重複防止フロー)側の責務であり、`is_reconcilable`の値によらない独立した処理として`JournalEntryRepository`が`external_transaction_refs`を作成する([2.1](#21-フィールド定義)「なぜ`account_id`にTRIGGER制約を設けないか」参照)。
- [1.4](#14-ライフサイクル)の突合済み仕訳の編集・削除ルールは[GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)(仕訳自体のライフサイクル設計)で決着し、[journal.md 1.5](./journal.md#15-仕訳の編集削除)に反映済み。
- [1.6](#16-原因不明差異への残高調整)の「残高調整」科目は[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)の現金の実残調整と共通の科目であり、`accounts.md`側のシステム管理科目定義に反映が必要。
- `external_transaction_refs.is_settled`は[statement-import.md 1.2](./statement-import.md#12-中間表現importedrecord)の`ImportedRecord.is_settled`の値をそのまま引き継ぐ。設定するのは[statement-import.md 2章](./statement-import.md#2-マッピング定義マスタimport_mapping_definitions)のマッピング定義であり、本ドメイン側では値の判定ロジックを持たない。
