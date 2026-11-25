# docs 更新履歴

OKF v0.2 の `log.md`。docs 配下の追加・構造変更・方針変更を日付ごとに新しい順で記録する。個々の設計判断は [decisions.md](./decisions.md) に書く。

## 2026-11-25

* **Creation**: OKF 運用規約([guides/okf-conventions.md](./guides/okf-conventions.md))と、実証実験の評価観点・所見の記録([guides/okf-experiment.md](./guides/okf-experiment.md))を追加した。`npm run docs:check`(準拠チェック、CI の `docs-check` ジョブ)を導入し、`.claude/agents/doc-updater.md` を OKF 対応にした。
* **Update**: `domain/*.md` の `resource` に、対応する実装のディレクトリ(`src/domain/<集約>`)を追加した。実装側の移動・削除を `docs:check` で検知するため。
* **Creation**: docs を OKF v0.2 のバンドルとして整備した(計画Issue #284、実証実験)。全ての概念文書に frontmatter(`type`・`title`・`description`・`tags`、domain 文書は対応する schema を `resource`)を付与し、[index.md](./index.md) と本ファイルを追加した。
* **Update**: [architecture.md](./architecture.md) の、リポジトリに存在しない `CLAUDE.md` への言及と、実体と異なる `ReadOnlyStorageAdapter` の名称を訂正した(監査の結果は計画Issue #284 のコメント)。
