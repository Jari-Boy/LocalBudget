実装内容を計画 Issue にコメントとして追記してください。

引数: `<計画 Issue 番号>`

## 手順

現在のブランチのコミット履歴と変更内容を確認する。

```bash
git log main...HEAD --oneline
git diff main...HEAD --stat
```

既存の `## Implementation Attempt` の数を数えて今回の試行番号を決める。

```bash
gh issue view <計画 Issue 番号> --comments --json comments \
  --jq '[.comments[] | select(.body | startswith("## Implementation Attempt"))] | length'
```

以下のフォーマットで Issue にコメントを追記する。

```bash
gh issue comment <計画 Issue 番号> --body "$(cat <<'EOF'
## Implementation Attempt N - YYYY-MM-DD

### 実装内容
- コミット単位ごとに変更内容を箇条書き

### 設計判断
- 判断した内容とその理由（evaluator が意図を理解できるように）

### テスト結果
- 通過 N / 失敗 N（@test-runner により確認済み）

### 前回差し戻しへの対応（2回目以降）
- 差し戻し理由に対してどう対処したか
EOF
)"
```

コメント追記後、追記した URL を出力して終了する。
