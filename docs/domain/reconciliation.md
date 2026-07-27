# 突合(Reconciliation)ドメイン

[domain.md](../domain.md)(エントリポイント)から分割された、外部明細との突合(Reconciliation)に関する詳細設計。

> **たたき台**
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

### 1.2 スコープ(要議論)

突合と一口に言っても複数の機能が混ざりやすいため、明確に切り分ける。

| 機能 | 内容 | MVPスコープ |
|---|---|---|
| (a) 重複取込防止 | 同じCSV明細を誤って2回取り込むことを防ぐ | **必須** |
| (b) 残高検証 | CSVに記載された取引後残高と帳簿残高が一致するか検証する | オプション(CSVに残高列がある金融機関のみ) |
| (c) 手入力とCSVのマッチング | 先に手入力した取引と、後から取り込んだCSV明細が同一取引である場合に統合する | **将来課題**(スコープ外) |

> **(c)を見送る理由**
> 「同じ取引を手入力とCSVインポートの両方で二重に記帳してしまう」問題への対処には、日付・金額の近似マッチングや手動での紐付けUIが必要になり複雑度が大きい。MVPでは「CSV取込で作られた明細の重複防止」のみに絞り、手入力分との統合は運用(CSV取込を基本とし、手入力は暫定記帳として後で確認する等)でカバーする前提とする。

### 1.3 データモデルの考え方

CSVの1行(またはCSVから生成された仕訳)を「外部取引」として、そこから生成された`journal_entries`への参照を記録する。外部取引を一意に特定するキー(`external_id`)が取得できる金融機関はそれを使い、取得できない場合は日付・金額・摘要から生成した正規化ハッシュで代替する(具体的な正規化ロジックはImporter層の実装課題、[counterparties.md 1.3](./counterparties.md#13-csvインポートとの関係)の摘要正規化と同様の考え方)。

`journal_entries`ではなく`journal_lines`ではなく仕訳ヘッダー単位で参照する。CSVの1行は通常1仕訳(入出金明細の片側+相手科目)に対応するため、[counterparties.md 1.2](./counterparties.md#12-紐づけ対象)の「取引先はPL行単位」とは異なり、突合は仕訳ヘッダー単位で十分と考える。

### 1.4 重複防止フロー

1. CSVをパースし、各行について`external_id`(またはハッシュ)を算出する
2. 同一`account_id` × `external_id`の組み合わせが`external_transaction_refs`に既に存在するか判定する
3. 存在すれば「取込済みの可能性」としてレビュー画面で警告し、既定では取り込まない。ユーザーが明示的に選択した場合のみ取り込みを許可する(意図的な再取込や、ハッシュ衝突などの誤検知を救済するため)
4. 存在しなければ新規取引として扱い、レビュー確定時に`journal_entries`と`external_transaction_refs`を同一トランザクションで作成する([journal.md 1.3](./journal.md#13-貸借バランスの検証)のRepository層での一括書き込みと同じ考え方)

### 1.5 ライフサイクル

- 仕訳(`journal_entries`)が削除された場合、対応する`external_transaction_refs`もCASCADE削除する。
- 突合済み(=`external_transaction_refs`に存在する)仕訳の編集・削除については、[journal.md 1.5](./journal.md#15-仕訳の編集削除)および[GitHub Issue #1](https://github.com/Jari-Boy/LocalBudget/issues/1)(仕訳自体のライフサイクル設計)で改めて検討する。少なくとも「突合済み明細を編集すると外部明細との対応が崩れる」ことをユーザーに警告する仕組みは必要になる見込み。

### 1.6 残高検証(将来拡張、(b)のスコープ)

CSVに取引後残高が含まれる金融機関では、`external_balance_after`を記録しておくことで、任意時点の帳簿残高([financial-statements.md 2.1 生成方式](./financial-statements.md#21-生成方式)のBS残高計算)と突き合わせ、差異があれば検知できる。MVPでは値の保存のみを行い、検証UIは将来課題とする。

---

## 2. 突合マスタ(external_transaction_refs)

### 2.1 フィールド定義

| カラム | 内容 | 制約・備考 |
|---|---|---|
| `id` | ID | PK |
| `account_id` | 対象口座 | FK、`is_reconcilable = true`の資産科目のみ許可(TRIGGERで強制) |
| `journal_entry_id` | 対応する仕訳 | FK、親削除時CASCADE |
| `external_id` | 外部取引の一意キー | 金融機関側のトランザクションIDまたは正規化ハッシュ |
| `external_balance_after` | 取引後残高 | 任意。CSVに残高列がある場合のみ格納([1.6](#16-残高検証将来拡張bのスコープ)参照) |
| `imported_at` | 取込日時 | |

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

`journal_entries`・`journal_lines`へのカラム追加は不要(FKは`external_transaction_refs`側が持つ)。ただし[1.5](#15-ライフサイクル)の通り、仕訳自体の編集・削除ルール(Issue #1)が固まった際、突合済み判定との整合を再確認する必要がある。
