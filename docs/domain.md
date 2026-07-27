# 家計簿ドメイン設計書

家計簿アプリ / Local-first・Double-entry・Open-source
複式簿記に基づく勘定科目・仕訳ドメインの体系と、一般ユーザー向けUXの仕様

[architecture.md](./architecture.md) 1章で「別ファイル(`docs/domain.md`)で定義する」と参照されているファイルの実体。勘定科目・仕訳など複式簿記ドメインの詳細ルールを定義する。DBスキーマ全体の技術選定・Repository層のインターフェース等、アプリ全体のアーキテクチャ判断はarchitecture.md側を正とする。

本ファイルは全体方針をまとめた**エントリポイント**であり、各ドメインの詳細(体系・ライフサイクル・マスタのフィールド定義・DDL)は[domain/](./domain/)配下のファイルに分割している([2章](#2-各ドメインの詳細)参照)。

---

## 目次

1. [全体方針](#1-全体方針)
2. [各ドメインの詳細](#2-各ドメインの詳細)

---

## 1. 全体方針

複式簿記の整合性を内部で厳格に保ちながら、会計知識のない一般ユーザーにも使える家計簿を目指す。

### 1.1 基本方針

- **複式簿記の整合性を守る。** 資産・負債・純資産・収益・費用を含む5区分で設計する。
- **会計用語をユーザーから抽象化し、DBには保持する。** UIは「口座を登録する」等のタスク単位で提示し、勘定科目・仕訳・借方貸方といった簿記概念を見せないが、内部データモデルはスキーマ・トリガーレベルで複式簿記のルールを厳格に守る。
- **FSは都度生成する。** 残高スナップショットは保持せず、財務諸表は仕訳から毎回集計する。
- **軸を分離する。** 勘定科目(用途)・取引先(支払先/相手方)・プロジェクト(目的)・世帯メンバー(誰の)は直交する別軸として扱う。4軸すべてを各ドメインの詳細で定義する([2章](#2-各ドメインの詳細)参照)。

### 1.2 用語

| 用語 | 実体 |
|---|---|
| 区分(勘定科目区分) | 資産/負債/純資産/収益/費用の5つ、ENUM値 |
| 勘定科目(Account) | ユーザーが実際に選ぶ科目、`accounts`の1レコード |
| 仕訳(JournalEntry) | 1つの取引を表す伝票。日付・摘要を持つヘッダー |
| 仕訳明細(JournalLine) | 仕訳を構成する各行。勘定科目・金額・借方/貸方(side)を持つ |
| プロジェクト(Project) | 「何の目的で使ったお金か」を表すタグ、`projects`の1レコード |
| 世帯メンバー(HouseholdMember) | 「誰の口座/誰の取引か」を表すタグ、`household_members`の1レコード。個人のほか、複数メンバーの集合(グループ)も同じ形式で登録できる([household-members.md 1.5](./domain/household-members.md#15-グループ複数メンバーの集合)参照) |
| 取引先(Counterparty) | 「どこで/誰に対しての取引か」を表すタグ、`counterparties`の1レコード。CSVインポート時の相手勘定科目のデフォルト推定にも用いる([counterparties.md 1章](./domain/counterparties.md#1-取引先)参照) |

---

## 2. 各ドメインの詳細

| ドメイン | 概要 | 詳細 |
|---|---|---|
| 勘定科目 | 資産・負債・純資産・収益・費用の5区分と、ユーザーが自由に追加する勘定科目(`accounts`)。ライフサイクル・表示用グルーピング(`account_groups`)・口座登録UXを含む | [domain/accounts.md](./domain/accounts.md) |
| 仕訳 | 複式簿記の仕訳(JournalEntry)・仕訳明細(JournalLine)。貸借バランス検証、金額と通貨の扱い、CSVインポートとの関係 | [domain/journal.md](./domain/journal.md) |
| プロジェクト | 「何の目的で使ったお金か」を表す横断タグ軸。PL科目の行にのみ設定可能 | [domain/projects.md](./domain/projects.md) |
| 世帯メンバー | 「誰の口座/誰の取引か」を表す軸。既定値の継承、個人・グループ(複数メンバーの集合)を扱う | [domain/household-members.md](./domain/household-members.md) |
| 取引先 | 「どこで/誰に対しての取引か」を表す軸。CSVインポートの自動推定・勘定科目のデフォルトサジェストに利用 | [domain/counterparties.md](./domain/counterparties.md) |
| 期間確定・財務諸表 | 締め(ロック)を設けない方針、PL/BS等FSの生成方式と表示UI | [domain/financial-statements.md](./domain/financial-statements.md) |
| 予算 | 勘定科目ごとの月次予算額と実績比較。**たたき台** | [domain/budgets.md](./domain/budgets.md) |
| 突合 | 外部明細(CSV)と仕訳の対応関係・重複取込防止。**たたき台** | [domain/reconciliation.md](./domain/reconciliation.md) |
| 定期取引 | 家賃・サブスク等、繰り返し発生する仕訳のテンプレート化。**たたき台** | [domain/recurring-transactions.md](./domain/recurring-transactions.md) |
