# docs 更新履歴

OKF v0.2 の `log.md`。docs 配下の追加・構造変更・方針変更を日付ごとに新しい順で記録する。個々の設計判断は [decisions.md](./decisions.md) に書く。

## 2026-11-25

* **Creation**: docs を OKF v0.2 のバンドルとして整備した(計画Issue #284、実証実験)。全ての概念文書に frontmatter(`type`・`title`・`description`・`tags`、domain 文書は対応する schema を `resource`)を付与し、[index.md](./index.md) と本ファイルを追加した。
* **Update**: [architecture.md](./architecture.md) の、リポジトリに存在しない `CLAUDE.md` への言及と、実体と異なる `ReadOnlyStorageAdapter` の名称を訂正した(監査の結果は計画Issue #284 のコメント)。
