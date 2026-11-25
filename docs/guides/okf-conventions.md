---
type: Guide
title: docs の OKF 運用規約
description: docs を Open Knowledge Format v0.2 のバンドルとして保つための約束(frontmatter の付け方・type の値・resource の扱い・stale_after と verified の方針・準拠チェック・仕様変更への追随手順)。
resource:
  - ../../scripts/docs-check/checkDocs.mjs
  - ../../scripts/check-docs.mjs
tags: [guide, okf, conventions]
---

# docs の OKF 運用規約

`docs/` は [Open Knowledge Format(OKF)v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) のバンドルとして管理している(計画Issue #284、実証実験)。この文書は運用の約束を定める。実験の評価は [okf-experiment.md](./okf-experiment.md) に記録する。

## 準拠する版

- **OKF v0.2**。バンドルルートの [index.md](../index.md) の frontmatter に `okf_version: "0.2"` を宣言している。
- 仕様は変動しうる(v0.1 から v0.2 の間にも `timestamp` の廃止などの破壊的変更があった)。版が上がったときの追随手順は末尾に書く。

## ファイルの区分

| 区分 | 対象 | 扱い |
|---|---|---|
| 概念文書 | `index.md` と `log.md` 以外の `docs/**/*.md` | frontmatter を必ず持つ |
| 予約ファイル | `index.md`・`log.md`(現在は `docs/` 直下だけに置いている) | `index.md` は frontmatter を持たない(バンドルルートの `index.md` だけ `okf_version` を持つ)。`log.md` は frontmatter を持たない。どの階層でも概念文書には使えない |
| 概念文書ではないもの | `docs/schema/*.sql` | frontmatter を持てないため、対応する domain 文書の `resource` から参照する(DDL の唯一の情報源は `.sql` のまま) |

## frontmatter

概念文書の先頭に置く。

```yaml
---
type: Domain
title: 勘定科目ドメイン
description: 一文の要約(index.md の一覧にそのまま出る)。
resource:
  - ../schema/accounts.sql
  - ../../src/domain/account
tags: [domain, accounts]
---
```

- **必須は `type` のみ**(SPEC)。このリポジトリでは `title`・`description`・`tags` も付ける。`title` は本文の H1 と同じにする。
- **使う値の部分集合**: 自作のチェック(下記)が解釈できるのは、`キー: 値`、インライン配列 `[a, b]`、ブロック配列(`- 値`)だけ。`{ by: x, at: y }` のような入れ子の値は生の文字列として保持され、中身は検査されない。複雑な構造が必要になったら、チェックの実装を拡張するか YAML ライブラリの導入を検討する。
- **`type` の値**(自由な文字列。SPEC は固定の分類を持たない。ここで使う値を決めておく):

  | type | 対象 |
  |---|---|
  | `Architecture` | `architecture.md` |
  | `Decision Log` | `decisions.md`(追記専用の時系列ログ) |
  | `Domain Overview` | `domain.md`(各ドメインへの入口) |
  | `Domain` | `domain/*.md` |
  | `Knowledge Log` | `guides/knowledge.md`(追記専用のログ) |
  | `Pattern Catalog` | `guides/patterns.md`(追記専用のカタログ) |
  | `Guide` | その他の手順・規約(`guides/*.md`) |
  | `Experiment Record` | 実験・評価の記録(`guides/okf-experiment.md`) |

## resource の扱い

- `resource` は、その文書が説明する実体のパス。**`../` 始まりの相対パス**で書く(`/` 始まりは SPEC ではバンドルルート=`docs/` 基準になり、`src/` を指せないため)。
- 指す先は次の2種類。
  - 対応する schema(`../schema/<名前>.sql`)。
  - 対応する実装のディレクトリ・ファイル(`../../src/domain/<集約>` など)。
- **目的は乖離の検知**。実装側でディレクトリやファイルがリネーム・削除されると、docs に差分が無くても `npm run docs:check` が失敗し、docs の見直しを促す。逆に、文書の内容が実装と一致しているかまでは検査しない。
- 指す先は少なく保つ。実装の細部まで列挙すると、移動のたびにチェックが失敗してノイズになる。集約・主要モジュールの単位にとどめる。
- 履歴ログ(`Decision Log`・`Knowledge Log`・`Pattern Catalog`)は過去の状態を指す記述を意図的に含むため、`resource` を付けない。

## status・stale_after・verified の方針

| 項目 | 方針 | 理由 |
|---|---|---|
| `status` | 付けない(省略は `stable` として扱われる)。廃止した文書だけ `deprecated` にする | 現行の文書がほぼすべてで、`stable` を全文書に書いても情報が増えない |
| `stale_after` | **使わない** | 絶対時刻の期限は、更新しなければ一斉に陳腐化扱いになり、警告が常態化して無視される。このプロジェクトには期限を能動的に更新する運用主体がなく、更新の契機は PR 差分(`doc-updater`)と `docs:check` で足りる |
| `verified` | **使わない** | 仕様では `human:` の主体は人間が確認した場合にだけ使う。AI(`doc-updater`)が自己申告で付けても信頼の信号にならず、人間が毎回付けるコストに見合わない。`generated` も同様 |

`stale_after`・`verified` は、段階4の振り返り([okf-experiment.md](./okf-experiment.md))で再評価する。

## 準拠チェック

```bash
npm run docs:check
```

- `docs/` の全 `.md` を検査し、違反があれば一覧を出して終了コード 1 で終わる。CI(`docs-check` ジョブ)でも実行する。
- 検査する内容は、SPEC の適合条件(解析可能な frontmatter・空でない `type`・`index.md`/`log.md` の構造)、`status`・`stale_after` の値の形式(書かれている場合のみ)、`resource` が指すパスの存在(http(s) は除く)。
- 検査しないもの: 本文の内容が実装と一致しているか、リンク切れ(SPEC は許容)、`description` の質。
- 実装は `scripts/docs-check/checkDocs.mjs`(テストは同ディレクトリ)。SPEC に lint が無いため自作しており、検査は SPEC の適合条件とパス存在確認に絞って作り込まない。

## docs を更新するときの約束

- 概念文書を**追加**したら、frontmatter を付け、`index.md` に1行追加し、`log.md` に記録する。
- 概念文書を**削除・改名・統合**したら、`index.md`・他の文書からのリンク・`log.md` を更新する。
- 本文の更新で文書の趣旨が変わったときは、`description` も直す。
- `log.md` には、ファイルの追加・削除・構造の変更・この規約の変更だけを書く。通常の本文の追記は、`decisions.md` と Issue・PR の履歴に残るため書かない。日付は `YYYY-MM-DD`、新しいものを先頭にする。
- 最後に `npm run docs:check` を実行して、違反が無いことを確認する。
- 運用の自動化は `.claude/agents/doc-updater.md` に定めている。

## 仕様の版が上がったとき

1. SPEC の「Versioning」と破壊的変更の節を読み、影響する項目を洗い出す。
2. `scripts/docs-check/checkDocs.mjs` とテストを先に更新する(red → green)。
3. `npm run docs:check` で違反を出し、docs を直す。
4. `index.md` の `okf_version` と、この文書の「準拠する版」を更新し、`log.md` に記録する。
