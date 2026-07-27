# 突合(Reconciliation)ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、外部明細との突合(Reconciliation)に関する詳細設計。

> **関連Issue**
> [architecture.md 12章](../architecture.md#12-起票方式csvインポートマニュアル起票)のCSVインポート方針、および[GitHub Issue #2](https://github.com/Jari-Boy/LocalBudget/issues/2)(CSVインポート・記帳方法の詳細設計)と密接に関わる。Importer層の実装方針が固まった段階で本ファイルも見直しが必要。

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
| (b) 取り込み漏れ検出 | CSVに記載された取引後残高と帳簿残高を比較する | オプション(CSVに残高列がある金融機関のみ)。[1.3](#13-is_reconcilable資産への直接記帳の制限)のルールにより記帳経路がCSVに限定される前提では、不一致は「帳簿の誤り」ではなく「まだ取り込んでいないCSV明細がある」ことを意味する |
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
2. 同一`account_id` × `external_id`の組み合わせが`external_transaction_refs`に既に存在するか判定する
3. 存在すれば「取込済みの可能性」としてレビュー画面で警告し、既定では取り込まない。ユーザーが明示的に選択した場合のみ取り込みを許可する(意図的な再取込や、ハッシュ衝突などの誤検知を救済するため)
4. 存在しなければ新規取引として扱う。レビュー画面では、未消込の未払金・未収金がある場合はその一覧をサジェストし、ユーザーが選べば[1.4](#14-暫定記帳未払金未収金と消込)の消込仕訳として、選ばなければ通常の新規仕訳として、`journal_entries`と`external_transaction_refs`を同一トランザクションで作成する([journal.md 1.3](./journal.md#13-貸借バランスの検証)のRepository層での一括書き込みと同じ考え方)。未消込の一時勘定候補のサジェスト方法(金額・日付の近似度等)はImporter層の実装課題とする

### 1.7 ライフサイクル

- 仕訳(`journal_entries`)が削除された場合、対応する`external_transaction_refs`もCASCADE削除する。削除後に同じ内容で正しく再取込すれば復元できるため、内容が誤っていた場合の訂正手段として使える。
- 突合済み(=`external_transaction_refs`に存在する)仕訳の編集・削除は、[journal.md 1.5 仕訳の編集・削除](./journal.md#15-仕訳の編集削除)の通り([GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)で決着)、`is_reconcilable`資産側の値を含めて許可する。UI上で「外部明細との対応が崩れる」警告を出すに留め、DB・Repository層での禁止は行わない。`external_transaction_refs`の存在は「CSV由来として作成されたことがある」ことのみを保証し、「現在の内容がCSVの生データと一致し続けている」ことは保証しない。

### 1.8 残高検証(将来拡張、(b)のスコープ)

CSVに取引後残高が含まれる金融機関では、`external_balance_after`を記録しておくことで、任意時点の帳簿残高([financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式)のBS残高計算)と突き合わせ、差異があれば検知できる。[1.3](#13-is_reconcilable資産への直接記帳の制限)の前提が守られていれば理論上差異は生じないため、この検証は「不正の検出」ではなく「まだ取り込んでいないCSV明細がある」ことに気づくための取り込み漏れ検出として位置づける。MVPでは値の保存のみを行い、検証UIは将来課題とする。

---

## 2. 突合マスタ(external_transaction_refs)

### 2.1 フィールド定義

| カラム                      | 内容        | 制約・備考                                            |
| ------------------------ | --------- | ------------------------------------------------ |
| `id`                     | ID        | PK                                               |
| `account_id`             | 対象口座      | FK、`is_reconcilable = true`の資産科目のみ許可(TRIGGERで強制) |
| `journal_entry_id`       | 対応する仕訳    | FK、親削除時CASCADE                                   |
| `external_id`            | 外部取引の一意キー | 金融機関側のトランザクションIDまたは正規化ハッシュ                       |
| `external_balance_after` | 取引後残高     | 任意。CSVに残高列がある場合のみ格納([1.8](#18-残高検証将来拡張bのスコープ)参照) |
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
- [1.7](#17-ライフサイクル)の通り、仕訳自体の編集・削除ルール(Issue #1)が固まった際、突合済み判定との整合を再確認する必要がある。
