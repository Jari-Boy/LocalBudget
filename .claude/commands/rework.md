evaluator に渡す前に実装を差し戻してください。

引数: `<計画 Issue 番号>` [修正指示（省略可）]

## 前提確認

evaluator への送付前（実装完了後・PASS/FAIL 前）に使うコマンドです。まず最新状態を確認する。

```bash
gh issue view <計画 Issue 番号> --comments --json comments \
  --jq '.comments | last | {starts_with_impl: (.body | startswith("## Implementation Attempt")), starts_with_review: (.body | startswith("## Review Attempt")), starts_with_human_rework: (.body | startswith("## Human Pre-Review - REWORK"))}'
```

- 最新コメントが `## Implementation Attempt` または `## Human Pre-Review - REWORK` → 続行
- 最新コメントが `## Review Attempt`（PASS/FAIL 済み）→ 「evaluator のレビュー後です。PASS を取り消したい場合は `/reject` を使ってください。」と案内して終了
- コメントなし → 「まだ実装が記録されていません。」と案内して終了

## 手順

### 1. 現在の実装内容を表示する

```bash
git log main...HEAD --oneline
git diff main...HEAD --stat
```

### 2. 修正指示を確認する

- 引数に修正指示が含まれている場合: それをそのまま使う
- 含まれていない場合: 現在の実装概要を示したうえで「どの部分をどう修正しますか？」と聞く

### 3. evaluator エージェントに委譲する

これから評価を行うのは `@evaluator` なので、Human Pre-Review - REWORK の記録も同じエージェントに依頼する。
まだ実装は評価させず、人間の事前指示をそのまま Issue コメントとして記録させるだけであることを明示する。

以下の情報をすべてプロンプトに含めて `@evaluator` に渡す。

- 計画 Issue 番号
- 修正指示（具体的に）

### 4. 完了後の案内

コメント追記が完了したら以下を案内する。

「Human Pre-Review - REWORK を記録しました。修正してから `/impl-comment <Issue番号>` で実装内容を更新し、その後 `@evaluator` に渡してください。」
