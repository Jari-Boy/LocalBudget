# 突合(Reconciliation)ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、外部明細との突合(Reconciliation)に関する詳細設計。

> **関連ドメイン**
> [architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)のCSVインポート方針を具体化した[csv-import.md](./csv-import.md)([GitHub Issue #2](https://github.com/Jari-Boy/LocalBudget/issues/2))と密接に関わる。本ファイルの重複防止([1.6](#16-重複防止フロー))・取り込み漏れ検出([1.8](#18-取り込み漏れ検出))は、csv-import.mdのレコード処理フロー([csv-import.md 1.4](./csv-import.md#14-レコード処理フロー))から呼び出される。

---

## 目次

1. [突合](#1-突合)
2. [突合マスタ(external_transaction_refs)](#2-突合マスタexternal_transaction_refs)

---

## 1. 突合

### 1.1 位置づけ

`is_reconcilable = true`の資産([accounts.md 4.2](./accounts.md#42-種類選択による照合可否の自動決定): 銀行口座・電子マネー・証券口座)は、CSV等で取り込んだ外部明細と帳簿上の仕訳を突き合わせることで帳簿の正しさを検証できる。この「外部明細と仕訳の対応関係」を記録するのが本ドメインの役割。

`is_reconcilable = false`の現金は対象外([financial-statements.md 1.2 資産の照合可否](./financial-statements.md#12-資産の照合可否)の実残調整で扱う)。

本ドメインの核心は「取り込んだCSVと帳簿を照合してズレを検出する」ことではなく、[1.3](#13-is_reconcilable資産への直接記帳の制限)の通り**そもそもズレが起こらない記帳経路に限定する**ことにある。CSV以外の経路(手入力・仕訳の自由な削除等)を無制限に許せば帳簿はいつでも外部の正と乖離しうるが、記帳経路をCSV(+初期登録)に絞れば、残高は構造的に一致する。

### 1.2 スコープ

突合と一口に言っても複数の機能が混ざりやすいため、明確に切り分ける。

| 機能 | 内容 | 位置づけ |
|---|---|---|
| (a) 重複取込防止 | 同じCSV明細を誤って2回取り込むことを防ぐ | **必須** |
| (b) 取り込み漏れ検出 | 前回の取込済み残高と新しいCSVの開始残高の連続性を検証する([1.8](#18-取り込み漏れ検出)参照) | **必須**(CSVに残高列がある金融機関のみ)。[1.3](#13-is_reconcilable資産への直接記帳の制限)によりis_reconcilable資産の記帳経路をCSVに限定した結果、取り込み漏れが起きるとその期間の記録は現金の実残調整のような救済手段なしに欠落し続ける。「オプションで検証できたら便利」ではなく(a)と同格の必須機能とする |
| (c) 手入力とCSVのマッチング | 先に手入力した取引と、後から取り込んだCSV明細が同一取引である場合に統合する | **専用機能としては不要**。[1.4](#14-暫定記帳未払金未収金と消込)の未払金/未収金を経由した消込という通常の複式簿記パターンで解消されるため、日付・金額の近似マッチングのような特別なアルゴリズムを別途作る必要がない |

### 1.3 is_reconcilable資産への直接記帳の制限

**`asset`区分かつ`is_reconcilable = true`の科目を借方/貸方に使う仕訳明細は、対応する`external_transaction_refs`(=CSV由来であること)を伴う場合のみ作成できる。** 唯一の例外は口座開設時の初期残高仕訳([accounts.md 4.3](./accounts.md#43-初期残高の自動仕訳))で、これはシステムによる一度きりのセットアップ操作として許可する。

このルールにより、銀行口座・電子マネー・証券口座の残高は「取り込んだCSVの積み上げ」と常に一致する。ユーザーが手入力で直接これらの科目を使ったり、仕訳を自由に削除・改変したりすることで残高が実態と乖離する、という事態が構造的に起こらなくなる。

> **なぜDBのTRIGGERで強制しないか**
> [journal.md 1.3 貸借バランスの検証](./journal.md#13-貸借バランスの検証)と同じ理由。SQLiteのTRIGGERはBEFORE INSERT時点で「このjournal_entryに対して、この後external_transaction_refsが作られる予定かどうか」を先読みできない。したがってこの制約もDB側では強制せず、`JournalEntryRepository`がアプリケーション層で強制する(仕訳と外部取引参照を同一トランザクションで作成し、is_reconcilable資産の行を含むのに外部取引参照を伴わない仕訳の作成をRepository層が拒否する)。

`liability`(負債)・`equity`(純資産)・`revenue`(収益)・`expense`(費用)の各区分はこのルールの対象外であり、従来どおり自由に手入力できる。`asset`区分でも`is_reconcilable = false`(現金、およびCSVが取得できない口座)は対象外で、[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)の実残調整で運用する。

### 1.4 暫定記帳(未払金・未収金)と消込

[1.3](#13-is_reconcilable資産への直接記帳の制限)により、家賃や給与のようにCSV到着前に記録したい取引では、口座科目を直接使えない。この場合、`liability`(未払金等)または`asset`(未収金等、ただし`is_reconcilable = false`)の一時勘定を経由して暫定計上し、CSV到着後にその一時勘定を口座科目で消し込む。

この形は新しい概念ではなく、[journal.md 1.2 記帳の型](./journal.md#12-記帳の型)にある「カードで買い物→後日引き落とし」の未払金パターンと同じ構造である。

```
例: 家賃(費用側)

暫定計上(手入力・定期取引): (借) 費用・家賃         80,000
                          (貸) 負債・未払金               80,000

CSV到着後の消込(CSV由来): (借) 負債・未払金         80,000
                          (貸) 資産・普通預金             80,000
```

```
例: 給与(収益側)

暫定計上(手入力・定期取引): (借) 資産・未収金        300,000
                          (貸) 収益・給与収入            300,000

CSV到着後の消込(CSV由来): (借) 資産・普通預金        250,000
                          (借) 費用・社会保険料         30,000
                          (借) 費用・所得税             20,000
                          (貸) 資産・未収金                  300,000
```

> **消込は金額が一致するとは限らない**
> 給与の例のように、天引き(社会保険料・所得税等)があると暫定計上額と実際の入金額はずれる。消込は単純な1:1の仕訳ではなく[journal.md 1.1](./journal.md#11-仕訳journalentryと仕訳明細journalline)の複合仕訳として行い、差額を按分する(天引き内訳を費用科目に分解するか、単に収益科目側の金額を実額に合わせるかはユーザーの任意)。按分しきらず未払金・未収金に残高が残ることも許容する。これは異常ではなく、見込みと実績のズレとして正常に起こりうる状態である。ドメイン側は「消込は複合仕訳として組める」という枠組みのみ提供し、按分方法そのものは規定しない。

`未収金`はCSVと直接照合されるべき本物の口座ではなく、あくまで内部の一時勘定であるため、`is_reconcilable = false`として登録する([accounts.md](./accounts.md)参照)。`is_reconcilable = true`にしてしまうと、[1.3](#13-is_reconcilable資産への直接記帳の制限)のルールにより未収金自体への暫定計上(手入力)ができなくなり本末転倒になる。

### 1.5 データモデルの考え方

CSVの1行(またはCSVから生成された仕訳)を「外部取引」として、そこから生成された`journal_entries`への参照を記録する。外部取引を一意に特定するキー(`external_id`)が取得できる金融機関はそれを使い、取得できない場合は日付・金額・摘要から生成した正規化ハッシュで代替する(具体的な正規化ロジックはImporter層の実装課題、[counterparties.md 1.3](./counterparties.md#13-csvインポートとの関係)の摘要正規化と同様の考え方)。

`journal_lines`ではなく仕訳ヘッダー単位で参照する。CSVの1行は通常1仕訳(入出金明細の片側+相手科目、または[1.4](#14-暫定記帳未払金未収金と消込)の消込仕訳)に対応するため、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)の「取引先はPL行単位」とは異なり、突合は仕訳ヘッダー単位で十分と考える。

### 1.6 重複防止フロー

1. CSVをパースし、各行について`external_id`(またはハッシュ)を算出する
2. 同一`account_id` × `external_id`の組み合わせが`external_transaction_refs`に既に存在するか判定する(完全一致)
3. 完全一致すれば「取込済みの可能性」としてレビュー画面で警告し、既定では取り込まない。ユーザーが明示的に選択した場合のみ取り込みを許可する(意図的な再取込や、ハッシュ衝突などの誤検知を救済するため)
4. 完全一致しない場合でも、同一`account_id`内に日付・金額が近い既存の仕訳があれば、「確定版の可能性がある明細」として候補を提示する(クレジットカードの速報→確定で内容が変わるケースへの対処、詳細は次項)
5. いずれにも該当しなければ新規取引として扱う。レビュー画面では、未消込の未払金・未収金がある場合はその一覧をサジェストし、ユーザーが選べば[1.4](#14-暫定記帳未払金未収金と消込)の消込仕訳として、選ばなければ通常の新規仕訳として、`journal_entries`と`external_transaction_refs`を同一トランザクションで作成する([journal.md 1.3](./journal.md#13-貸借バランスの検証)のRepository層での一括書き込みと同じ考え方)。未消込の一時勘定候補のサジェスト方法(金額・日付の近似度等)はImporter層の実装課題とする

**確定版候補のサジェストと置き換え(クレジットカードの速報/確定対策)**

クレジットカードの明細は、速報時点と確定後で金額・摘要が変わることがある(海外利用時の為替確定、高速道路料金の後日確定等)。`external_id`(またはハッシュ)による完全一致だけに頼ると、確定後の再取込が「別の取引」として扱われ二重計上されてしまう。

そこで(4)の通り、完全一致しなくても同一`account_id`内で日付・金額が近い既存の仕訳があれば候補として提示する。ユーザーが「これは確定版です」と選択した場合、既存の仕訳を削除し、確定後の内容で取り込む。これは[1.7 ライフサイクル](#17-ライフサイクル)の「削除して正しい内容で再取込」パターンをそのまま使うため、新しい仕組みを追加する必要はない。ユーザーが「別の取引です」と選択すれば通常どおり新規取引として扱う。

近似判定の具体的な閾値(日数・金額差の許容範囲)はドメイン設計のスコープ外とし、Importer層の実装課題とする。金融機関によって速報/確定のズレ方(数日〜数週間、手数料相当の差額等)が異なるため、固定値をドメイン側で決め打ちしない。

> **なぜ自動で置き換えないか**
> [csv-import.md 1.5](./csv-import.md#15-相手勘定科目サジェストの範囲)で取引先の類似度推定を見送った判断とは、外れた場合のコストが非対称である点が異なる。取引先サジェストが外れても手動選択の手間が増えるだけだが、重複判定を誤って自動処理すると、別の取引を誤って削除する、あるいは二重計上を見逃す、というデータ整合性上の実害が生じる。したがって候補は提示するが、確定は常にユーザーのレビューを必須とする([architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)の一貫方針)。

### 1.7 ライフサイクル

- 仕訳(`journal_entries`)が削除された場合、対応する`external_transaction_refs`もCASCADE削除する。削除後に同じ内容で正しく再取込すれば復元できるため、内容が誤っていた場合の訂正手段として使える。
- 突合済み(=`external_transaction_refs`に存在する)仕訳の編集・削除は、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)、`is_reconcilable`資産側の値を含めて許可する。UI上で「外部明細との対応が崩れる」警告を出すに留め、DB・Repository層での禁止は行わない。`external_transaction_refs`の存在は「CSV由来として作成されたことがある」ことのみを保証し、「現在の内容がCSVの生データと一致し続けている」ことは保証しない。

### 1.8 取り込み漏れ検出

CSVに取引後残高が含まれる金融機関では、`external_balance_after`を記録しておく([2.1](#21-フィールド定義)参照)。新しいCSVを取り込む際、以下のフローで連続性を検証する。

1. 対象口座の直近の`external_transaction_refs.external_balance_after`(前回の取込済み最終残高)を取得する
2. 新しいCSVの最初の行が示す「取引直前の残高」を求める(CSVに取引前残高列があればそれを使い、なければ「最初の行の`external_balance_after` − 最初の行の`amount`」で逆算する)
3. 1と2が一致しなければ、レビュー画面で「◯月◯日以降の記録が抜けている可能性があります」のように警告する
4. 警告は取り込みを止めるものではない(既定で取り込みは許可する)。該当期間のCSVを別途再取込することで解消するのが正規のフロー

[1.3](#13-is_reconcilable資産への直接記帳の制限)の前提が守られていれば理論上差異は生じないため、この検証は「不正の検出」ではなく「まだ取り込んでいないCSV明細がある」ことに気づくためのものである。CSVに残高列がない金融機関ではこの検証自体ができず、取り込み漏れがあっても気づけないリスクが残る(CSVフォーマットの限界であり、ドメイン側では解決できない)。

### 1.9 原因不明差異への残高調整

[1.8](#18-取り込み漏れ検出)の警告を受けて再取込しても、なお解消しない差異が残ることがある(該当期間のCSVがそもそも取得不能、銀行側の処理タイミングのズレ等)。この場合、[financial-statements.md 1.2 資産の照合可否](./financial-statements.md#12-資産の照合可否)の現金の実残調整と同じ発想で、**ユーザーが「これ以上原因を追わず差額を確定する」ことを明示的に選んだときのみ**、システム管理科目「費用・残高調整」を相手科目とする調整仕訳を生成する。差異を検出した時点でシステムが自動生成することはしない([architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)の「レビューを経てから確定する」という一貫方針との整合による)。

「残高調整」は現金の実残調整で使う科目と共通化する([financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)参照)。トリガーとなる操作(現金は実残の手入力、`is_reconcilable = true`資産はCSV残高との比較)が違うだけで、「帳簿と外部の正との差異を吸収する費用科目」という会計処理上の構造は同じであるため。

---

## 2. 突合マスタ(external_transaction_refs)

### 2.1 フィールド定義

| カラム                      | 内容        | 制約・備考                                            |
| ------------------------ | --------- | ------------------------------------------------ |
| `id`                     | ID        | PK                                               |
| `account_id`             | 対象口座      | FK、`is_reconcilable = true`の資産科目のみ許可(TRIGGERで強制) |
| `journal_entry_id`       | 対応する仕訳    | FK、親削除時CASCADE                                   |
| `external_id`            | 外部取引の一意キー | 金融機関側のトランザクションIDまたは正規化ハッシュ                       |
| `external_balance_after` | 取引後残高     | 任意。CSVに残高列がある場合のみ格納([1.8](#18-取り込み漏れ検出)参照) |
| `imported_at`            | 取込日時      |                                                  |

同一口座内で`external_id`は重複登録できない(重複防止の要)。

### 2.2 DDL

```sql
CREATE TABLE external_transaction_refs (
  id                      INTEGER PRIMARY KEY,
  account_id              INTEGER NOT NULL REFERENCES accounts(id),
  journal_entry_id        INTEGER NOT NULL
    REFERENCES journal_entries(id) ON DELETE CASCADE,
  external_id             TEXT NOT NULL,
  external_balance_after  INTEGER,
  imported_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_external_txn_refs_dedup
  ON external_transaction_refs(account_id, external_id);
CREATE INDEX idx_external_txn_refs_entry
  ON external_transaction_refs(journal_entry_id);

-- account_id は is_reconcilable = true の資産科目のみ許可
-- (CHECK制約はサブクエリ不可のためTRIGGERで実装)
CREATE TRIGGER prevent_external_ref_on_non_reconcilable_account
BEFORE INSERT ON external_transaction_refs
WHEN (SELECT is_reconcilable FROM accounts WHERE id = NEW.account_id) IS NOT TRUE
BEGIN
  SELECT RAISE(ABORT, 'external_transaction_refs can only reference reconcilable accounts');
END;
```

### 2.3 他ドメインへの影響

`journal_entries`・`journal_lines`へのカラム追加は不要(FKは`external_transaction_refs`側が持つ)。ただし以下の点は他ドメインの反映が必要。

- [1.3](#13-is_reconcilable資産への直接記帳の制限)の記帳経路制限は`JournalEntryRepository`(仕訳ドメイン、[journal.md](./journal.md))の実装要件になる。
- [1.4](#14-暫定記帳未払金未収金と消込)の未収金は、口座登録UXとは別に「一時勘定」として`is_reconcilable = false`の資産科目をユーザーが作成できる必要がある([accounts.md](./accounts.md)参照)。
- [1.7](#17-ライフサイクル)の突合済み仕訳の編集・削除ルールは[GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)(仕訳自体のライフサイクル設計)で決着し、[journal.md 1.5](./journal.md#15-仕訳の編集削除)に反映済み。
- [1.9](#19-原因不明差異への残高調整)の「残高調整」科目は[financial-statements.md 1.2](./financial-statements.md#12-資産の照合可否)の現金の実残調整と共通の科目であり、`accounts.md`側のシステム管理科目定義に反映が必要。
