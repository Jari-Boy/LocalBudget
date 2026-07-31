現在のブランチの変更をもとに PR を作成してください。

**全ステップを途中で止まらず最後まで一気に実行すること。PR 作成まで走り切ること。**

## 手順

### 1. evaluator の PASS を確認する

計画 Issue 番号が分かる場合（`/develop` を経由したブランチ）は以下で確認する。

```bash
gh issue view <計画 Issue 番号> --comments --json comments \
  --jq '[.comments[] | select(.body | contains("判定: PASS"))] | last | .body // "PASS なし"'
```

- **PASS が確認できない場合** → 「evaluator による承認がまだです。`@evaluator` を実行してください。」と伝えて中断する
- **計画 Issue がない場合**（chore/hotfix/依存更新など `/develop` を経由しないブランチ）→ このステップをスキップしてよい

### 2. 静的解析

`linter` サブエージェントに委譲する。

- FAIL の場合はここで停止し、問題一覧をユーザーに報告する

### 3. ドキュメント更新

`/update-docs` を実行する。

### 4. 変更をコミット

ドキュメント更新の差分をコミットする。

### 5. PR 作成

`/create-pr.md` を実行する。
