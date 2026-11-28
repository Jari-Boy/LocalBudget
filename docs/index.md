---
okf_version: "0.2"
---

# ローカル家計簿PWA ドキュメント

このディレクトリは [Open Knowledge Format(OKF)v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) のバンドルとして管理している(計画Issue #284、実証実験)。
運用の約束(frontmatter の付け方・`resource` の扱い・準拠チェック)は [docs の OKF 運用規約](./guides/okf-conventions.md)、実験の評価は [OKF 導入の実証実験](./guides/okf-experiment.md)、更新履歴は [log.md](./log.md)。

## 設計方針

* [アーキテクチャ方針](./architecture.md) - アプリ全体のアーキテクチャ方針(技術選定・永続化・DBアクセス層・テスト戦略など)とその理由・トレードオフ。
* [意思決定ログ](./decisions/index.md) - 実装フェーズで生じた個別の設計判断を、1決定=1ファイルで記録した意思決定ログ。現行の決定と置き換え済みの決定を区別して一覧する。決定の本文は当時の判断として残す。

## ドメイン

* [家計簿ドメイン設計書](./domain.md) - 複式簿記ドメイン全体の方針と、各ドメイン詳細への入口。
* [勘定科目ドメイン](./domain/accounts.md) - 勘定科目(5区分・ライフサイクル・グルーピング)と、科目管理・口座登録のUX。
* [予算ドメイン](./domain/budgets.md) - 勘定科目ごとの月次予算額と、実績との比較。
* [取引先ドメイン](./domain/counterparties.md) - 取引先マスタと、摘要のキーワードルールによる取引先・科目の推定。
* [経費割勘(按分)ドメイン](./domain/expense-splitting.md) - 複数人で分担する支出の按分(割勘)と、未収金(精算バッチ)を経由した精算。
* [期間確定・財務諸表ドメイン](./domain/financial-statements.md) - 期間確定を設けない方針と、PL/BS等の財務諸表の生成方式・表示。
* [世帯メンバードメイン](./domain/household-members.md) - 世帯メンバー(個人・グループ)マスタと、明細行の世帯メンバーの決め方。
* [仕訳テンプレートドメイン](./domain/journal-templates.md) - よく使う仕訳のひな形(仕訳テンプレート)と、そこからの起票。
* [仕訳ドメイン](./domain/journal.md) - 仕訳・仕訳明細の構造、貸借バランス検証、金額と通貨、下書き、操作履歴。
* [プロジェクトドメイン](./domain/projects.md) - 「何の目的で使ったお金か」を表すプロジェクト軸と、そのグルーピング。
* [突合ドメイン](./domain/reconciliation.md) - 外部明細(CSV)と仕訳の突合・重複取込防止・残高照合。
* [定期仕訳ドメイン](./domain/recurring-transactions.md) - 家賃・サブスク・ローン返済など繰り返し発生する仕訳のルールと、提案・承認の流れ。
* [消込ドメイン](./domain/settlement.md) - 暫定記帳(未払金・未収金)とCSV到着後の消込、精算バッチ。
* [外部明細取込ドメイン](./domain/statement-import.md) - 金融機関の明細(CSV)の取込フロー、マッピング定義、レビュー画面。

## ガイド

* [技術知見](./guides/knowledge.md) - sql.js・Web Worker・StorageAdapter・PWA 等の実装で得た技術知見を蓄積する追記専用のログ。
* [実装ミスパターン](./guides/patterns.md) - evaluator の指摘や実装中にハマった点から得た実装ミスパターンの蓄積。旧画面のパスは履歴として残す。
* [スキーマ変更ガイド](./guides/schema-migration.md) - スキーマ変更の手順(最新スキーマと差分の書き方、凍結前後の運用)。
* [docs の OKF 運用規約](./guides/okf-conventions.md) - docs を Open Knowledge Format v0.2 のバンドルとして保つための約束(frontmatter の付け方・type の値・resource の扱い・stale_after と verified の方針・準拠チェック・仕様変更への追随手順)。
* [OKF 導入の実証実験](./guides/okf-experiment.md) - docs を OKF v0.2 に準拠させる実証実験の目的・評価観点・判定基準と、導入後の所見・継続か見直しかの結論の記録。

## スキーマ(DDL)

DDL の唯一の情報源(`?raw` インポートで実装が直接読む)。概念文書ではないため frontmatter は持たず、対応するドメイン文書の `resource` から参照する。

* [accounts.sql](./schema/accounts.sql) - 勘定科目・科目グループ・科目の統合ログ。
* [budgets.sql](./schema/budgets.sql) - 予算。
* [counterparties.sql](./schema/counterparties.sql) - 取引先・取引先グループ・統合ログ。
* [household_members.sql](./schema/household_members.sql) - 世帯メンバーとグループの所属。
* [journal.sql](./schema/journal.sql) - 仕訳・仕訳明細・下書き・関連仕訳グループ・割勘元明細。
* [journal_templates.sql](./schema/journal_templates.sql) - 仕訳テンプレートとそのグループ。
* [keyword_rules.sql](./schema/keyword_rules.sql) - 摘要のキーワードルール。
* [projects.sql](./schema/projects.sql) - プロジェクトとそのグループ。
* [reconciliation.sql](./schema/reconciliation.sql) - 外部取引の参照・残高記録。
* [recurring_transactions.sql](./schema/recurring_transactions.sql) - 定期仕訳のルール・金額・スキップ。
* [seed_markers.sql](./schema/seed_markers.sql) - 初期データ投入の冪等化マーカー。
* [settlement_batches.sql](./schema/settlement_batches.sql) - 精算バッチ。
* [statement_import.sql](./schema/statement_import.sql) - 明細取込のマッピング定義・下書き。
