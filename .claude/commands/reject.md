evaluator が PASS とした実装を人間がリジェクトしてください。

引数: `<計画 Issue 番号>` [リジェクト理由（省略可）]

## 前提確認

evaluator の PASS が前提のコマンドです。まず最新状態を確認する。

```bash
gh issue view <計画 Issue 番号> --comments --json comments \
  --jq '[.comments[] | select(.body | startswith("## Review Attempt"))] | last | {body: .body}'
```

最新の Review Attempt が `判定: PASS` でない場合は「最新のレビューが PASS ではありません。このコマンドは evaluator の PASS 後に使用してください。」と報告して終了する。

## 手順

### 1. リジェクト理由を確認する

- 引数にリジェクト理由が含まれている場合: それをそのまま使う
- 含まれていない場合: 「どのような理由でリジェクトしますか？また、次の実装試行への具体的な指示があれば教えてください。」と聞く

### 2. evaluator エージェントに委譲する

PASS 判定を出したのは `@evaluator` なので、Human Override - REJECT の記録も同じエージェントに依頼する。
再評価はさせず、人間の判断をそのまま Issue コメントとして記録させるだけであることを明示する。

以下の情報をすべてプロンプトに含めて `@evaluator` に渡す。

- 計画 Issue 番号
- リジェクト理由
- 次の実装試行への指示（ユーザーが述べた場合）

### 3. 完了後の案内

コメント追記が完了したら以下を案内する。

「Human Override - REJECT を記録しました。`/develop <Issue番号>` を実行すると次の実装試行を開始します（試行回数は前回から継続します）。」
