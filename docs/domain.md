---
type: Domain Overview
title: 家計簿ドメイン設計書
description: 複式簿記ドメイン全体の方針と、各ドメイン詳細(docs/domain/)への入口。
tags: [domain, entry-point]
---
# 家計簿ドメイン設計書

家計簿アプリ / Local-first・Double-entry・Open-source
複式簿記に基づく勘定科目・仕訳ドメインの体系と、一般ユーザー向けUXの仕様

[architecture.md](./architecture.md) 1章で「別ファイル(`docs/domain.md`)で定義する」と参照されているファイルの実体である。勘定科目・仕訳など複式簿記ドメインの詳細ルールを定義する。DBスキーマ全体の技術選定・Repository層のインターフェース等、アプリ全体のアーキテクチャ判断はarchitecture.md側を正とする。

本ファイルは全体方針をまとめた**エントリポイント**である。各ドメインの詳細(体系・ライフサイクル・マスタのフィールド定義・制約の設計判断)は[domain/](./domain/)配下のファイルに分割している([2章](#2-各ドメインの詳細)参照)。実際のCREATE TABLE等のDDLは[schema/](./schema/)配下に分離しており、各ドメインファイルからリンクで参照する。

---

## 目次

1. [全体方針](#1-全体方針)
2. [各ドメインの詳細](#2-各ドメインの詳細)

---

## 1. 全体方針

複式簿記の整合性を内部で厳格に保ちながら、会計知識のない一般ユーザーにも使える家計簿を目指す。

### 1.1 基本方針

- **複式簿記の整合性を守る。** 資産・負債・純資産・収益・費用を含む5区分で設計する。
- **簿記の整合性はDBで守り、UIは入口をタスク単位にして用語を説明する。** 口座・クレジットカードの登録、割勘、精算、明細取込などの入口は「口座を登録する」等のタスク単位で提示し、簿記の知識を前提にしない。一方、仕訳画面は借方・貸方を並べた表で仕訳の中身をそのまま見せて編集できるようにしている(自分の記帳を確かめて直せるようにするため)。簿記用語は用語集(`/glossary`)で説明する。内部データモデルは、スキーマ・トリガーレベルで複式簿記のルールを厳格に守る。
- **財務諸表(FS)は都度生成する。** 残高スナップショットは保持せず、財務諸表は仕訳から毎回集計する。
- **軸を分離する。** 勘定科目(用途)・取引先(支払先/相手方)・プロジェクト(目的)・世帯メンバー(誰の)は直交する別軸として扱う。この4軸を各ドメインの詳細で定義する([2章](#2-各ドメインの詳細)参照)。仕訳の絞り込みでは、これに精算バッチ(精算のまとまり)と出どころ(`source_type`)を加えた6軸を使う。軸の内側(同じ軸の項目指定とグループ指定)はOR、軸同士はANDで結合する。
- **現行の姿は各ドメイン文書に書き、経緯は[意思決定ログ](./decisions/index.md)に残す。** 各ドメイン文書は現在の仕様を書く。なぜそうしたか、何を置き換えたかは意思決定ログに残し、ドメイン文書からリンクする。

### 1.2 用語

| 用語 | 実体 |
|---|---|
| 区分(AccountCategory) | 資産・負債・純資産・収益・費用の5つ、ENUM値 |
| 勘定科目(Account) | 「何に使ったお金か」を表す軸、ユーザーが実際に選ぶ科目、`accounts`の1レコード |
| 仕訳(JournalEntry) | 1つの取引を表す伝票。日付・摘要を持つヘッダー |
| 仕訳明細(JournalLine) | 仕訳を構成する各行。勘定科目・金額・借方/貸方(side)を持つ |
| プロジェクト(Project) | 「何の目的で使ったお金か」を表す軸、`projects`の1レコード |
| 世帯メンバー(HouseholdMember) | 「誰の口座/誰の取引か」を表す軸、`household_members`の1レコード。個人のほか、複数メンバーの集合(グループ)も同じ形式で登録できる([household-members.md 1.5](./domain/household-members.md#15-グループ複数メンバーの集合)参照) |
| 精算バッチ(SettlementBatch) | 割勘の一時勘定(未収金(精算バッチ)・未払金(精算バッチ))の消込をまとめる単位、`settlement_batches`の1レコード。仕訳明細行の`settlement_batch_id`でタグ付けし、残高は同じタグの明細の集計で求める([settlement.md 1.7](./domain/settlement.md#17-タグ付き一時勘定の消込settlement_batch_idによるタグ付け)参照) |
| 関連仕訳グループ(JournalEntryLinkGroup) | 複数の仕訳を任意にまとめて関連づける多対多のグループ、`journal_entry_link_groups`([journal.md 1.8](./domain/journal.md#18-関連仕訳グループjournal_entry_link_groups)参照) |
| 取引先(Counterparty) | 「どこで/誰に対しての取引か」を表す軸、`counterparties`の1レコード。外部明細取込時の相手勘定科目のデフォルト推定にも用いる([counterparties.md 1章](./domain/counterparties.md#1-取引先)参照) |

---

## 2. 各ドメインの詳細

| ドメイン | 概要 | 詳細 |
|---|---|---|
| 勘定科目 | 資産・負債・純資産・収益・費用の5区分と、ユーザーが自由に追加する勘定科目(`accounts`)。ライフサイクル・表示用グルーピング(`account_groups`)・口座登録UX/クレジットカード登録UXを含む。 | [domain/accounts.md](./domain/accounts.md) |
| 仕訳 | 複式簿記の仕訳(JournalEntry)・仕訳明細(JournalLine)。貸借バランス検証、金額と通貨の扱い、外部明細取込との関係、途中入力を保持する下書き(journal_entry_drafts)。 | [domain/journal.md](./domain/journal.md) |
| プロジェクト | 「何の目的で使ったお金か」を表す横断的な軸。全区分(資産・負債・純資産・収益・費用)の行に設定可能。 | [domain/projects.md](./domain/projects.md) |
| 世帯メンバー | 「誰の口座/誰の取引か」を表す軸。明細行の世帯メンバーの決め方(科目の既定メンバー・起票者)、個人・グループ(複数メンバーの集合)を扱う。 | [domain/household-members.md](./domain/household-members.md) |
| 取引先 | 「どこで/誰に対しての取引か」を表す軸。外部明細取込・勘定科目のデフォルト推定に利用。 | [domain/counterparties.md](./domain/counterparties.md) |
| 期間確定・財務諸表 | 締め(ロック)を設けない方針、PL/BS等FSの生成方式と表示UI。 | [domain/financial-statements.md](./domain/financial-statements.md) |
| 予算 | 勘定科目ごとの月次予算額と実績比較。 | [domain/budgets.md](./domain/budgets.md) |
| 突合 | 外部明細(CSV)と仕訳の対応関係・重複取込防止・残高照合。 | [domain/reconciliation.md](./domain/reconciliation.md) |
| 消込 | 暫定記帳(未払金・未収金)とCSV到着後の消込という会計処理パターン。 | [domain/settlement.md](./domain/settlement.md) |
| 割勘 | 複数人で分担する支出の按分(割勘)。未収金(精算バッチ)(一時勘定)を経由した世帯メンバー間・世帯外の相手との精算。 | [domain/expense-splitting.md](./domain/expense-splitting.md) |
| 定期仕訳 | 家賃・サブスク・給与・ローン返済等、繰り返し発生する仕訳(複合仕訳・回ごとに金額が変わる償却やローンを含む)のテンプレート化。 | [domain/recurring-transactions.md](./domain/recurring-transactions.md) |
| 仕訳テンプレート | よく使う仕訳のひな形(繰り返し周期・提案を持たない)。仕訳画面の「テンプレート」タブで管理し、「テンプレートから起票」で新規仕訳フォームへ展開する。 | [domain/journal-templates.md](./domain/journal-templates.md) |
| 外部明細取込 | 金融機関の明細(CSV等)の取込フロー。マッピング定義・照合機能。 | [domain/statement-import.md](./domain/statement-import.md) |

### 2.1 ドメインをまたぐ機能の入口

専用のドメイン文書を持たず、複数のドメインや全体の仕組みにまたがる機能は、次の文書に書かれている。

| 機能 | 概要 | 詳細 |
|---|---|---|
| 初回セットアップ・用語集・はじめのチェックリスト | 初回起動時の保存先・世帯メンバー・科目の初期設定(`onboarding_completed`の印は`seed_markers`)、簿記用語の用語集(`/glossary`)。 | [architecture.md 6章](./architecture.md)の実装状況(計画Issue #177)、[accounts.md 3.1](./domain/accounts.md#31-フィールド定義) |
| キーワードルール | 摘要のキーワードから取引先・相手科目を推定する`keyword_rules`。 | [counterparties.md 1.3](./domain/counterparties.md#13-外部明細取込との関係)、[schema/keyword_rules.sql](./schema/keyword_rules.sql) |
| 操作履歴(ロールバック) | Workerのメモリに記録する逆操作SQLによる取消。永続化しない。 | [journal.md 1.5](./domain/journal.md#15-仕訳の編集削除)、[architecture.md 2章](./architecture.md) |
| スキーマ変更(マイグレーション) | 本番運用後のスキーマ変更の手順(最新スキーマ+差分、凍結)。 | [guides/schema-migration.md](./guides/schema-migration.md) |
| 分析(グラフ・推移) | FS・予算・グラフ分析を1画面に統合した分析画面(`src/domain/analysis`)。 | [financial-statements.md 2章](./domain/financial-statements.md#2-財務諸表fs)、[budgets.md](./domain/budgets.md) |
| 勘定科目グループ | 科目の表示用グルーピング(`account_groups`)。 | [accounts.md 3.3](./domain/accounts.md#33-勘定科目グループマスタaccount_groups) |
