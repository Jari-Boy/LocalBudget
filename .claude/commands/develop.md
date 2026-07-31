計画 Issue に基づいて実装・評価ループを実行してください。

引数として計画 Issue 番号を受け取る。

**全ループを人間の確認なしに自動で回すこと。Escape で中断された場合は `/resume` で再開できる。**

## 準備

### 1. 計画 Issue を読む

```bash
gh issue view <計画 Issue 番号> --comments
```

- 完了条件・前回差し戻し理由を把握する
- 既存の `## Implementation Attempt` の数 + 1 = 今回の試行番号

### 2. 必要なドキュメントを参照する

- アーキテクチャ方針・レイヤー分離を確認する場合 → `docs/architecture.md` を Read する
- ドメインモデルを変更・参照する場合 → `docs/domain.md` と該当する `docs/domain/*.md` を Read する
- DB スキーマを変更・参照する場合 → 該当する `docs/schema/*.sql` を Read する

### 3. コミット単位を設計する

Grep/Glob でコードベースを調査し、変更が必要な範囲を把握したうえで 1〜5 件の論理単位に分割する。

例：
- Attempt 1: ドメインモデル追加（`src/domain/` + `src/domain/__tests__/`）
- Attempt 2: Repository/StorageAdapter 実装（`src/infrastructure/` + `src/infrastructure/__tests__/`）
- Attempt 3: UI コンポーネント追加（`src/components/` + `src/components/__tests__/`）

実装中に実態と乖離した場合は随時修正してよい。

## 実装ループ（最大3回）

### フェーズ 1：実装（論理単位ごとに繰り返す）

各コミット単位について：

**1. 実装（TDD: red → green → refactor）**
- 必要に応じて WebFetch/WebSearch でドキュメントを参照する

**2. @linter を呼ぶ**
- 編集したファイルのパスをスコープとして渡す（例: `src/domain/xxx.ts`）
- FAIL なら修正してから次へ

**3. commit**
`/commit` を実行する

### フェーズ 2：テスト確認

全論理単位の実装完了後、`test-runner` サブエージェントを呼ぶ。
編集したモジュールに対応するテストパスを渡す（例: `src/domain/ src/infrastructure/`）。
Service Worker・マニフェスト・File System Access 連携等 E2E 対象の変更を含む場合は、その旨を伝えて Playwright も実行させる。

- **PASS** → フェーズ 3 へ
- **FAIL** → 修正して commit し、再度 @test-runner を呼ぶ

### フェーズ 3：評価

`/impl-comment <計画 Issue 番号>` を実行して実装内容を Issue にコメントとして追記する。

`evaluator` サブエージェントに計画 Issue 番号を渡す。

- **PASS** → 「実装が承認されました。`/pr` を実行して PR を作成してください。」と案内して終了
- **FAIL（1〜2回目）** → 差し戻し理由は Issue コメントに記載済み。次の Attempt へ
- **FAIL（3回目）** → 「3回の試行で評価を通過できませんでした。計画 Issue #XX を見直してください。実装の問題ではなく計画の完了条件・制約に問題がある可能性があります。」と報告して停止

## 制約

- 完了条件を「すべて」満たすことを最優先にする
- 計画 Issue に書かれていない詳細は、プロジェクトの既存方針に従って最善の判断で決める
- テストを書かずに実装してはいけない（TDD 必須）
- `git add -A` は使用禁止。ファイルを個別に指定すること
