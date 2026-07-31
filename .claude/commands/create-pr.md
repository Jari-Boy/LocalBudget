現在のブランチの変更をもとに PR を作成してください。

**計画 Issue がある場合:**

```bash
gh issue view <計画 Issue 番号>
gh issue view <計画 Issue 番号> --comments
```

- 本文（背景・目標・完了条件）と最終 evaluator コメントを読む
- `Related #XX` 行から元 Issue 番号を取得する

**計画 Issue がない場合:**

```bash
git log main...HEAD --oneline
git diff main...HEAD --stat
```

git log と変更内容から PR タイトル・説明文を生成する。

**PR タイトルのルール:**
- 70文字以内
- 計画 Issue の「目標」を端的に表す（コミットメッセージの転記ではなく）

**PR 説明文のフォーマット:**

```markdown
## Summary
- 何を実装したかを箇条書き（3点以内）

## Background
背景から1〜2文で要約

## Test plan
- [ ] evaluator が確認したこと（計画 Issue がない場合は主要な動作確認項目）

Closes #<元 Issue 番号>（計画 Issue がない場合は省略）
Related #<計画 Issue 番号>（計画 Issue がない場合は省略）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

**PR を作成する:**

PowerShell では `--body` に日本語を渡すと文字化けするため、必ず Write ツールで本文をスクラッチパッドに書き出してから `--body-file` で渡すこと。

```
# 1. Write ツールで本文をファイルに書き出す（UTF-8 で保存される）
Write(file_path="<scratchpad>/pr-body.md", content="<本文>")

# 2. --body-file でファイルを参照して PR を作成する
gh pr create --title "<title>" --body-file "<scratchpad>/pr-body.md" --base main
```

base ブランチは常に `main`。Draft PR にはしない（明示的に指示がある場合を除く）。

## 注意事項

- main への直接 push は禁止。必ず feature ブランチから PR を作る
- lint FAIL の状態で PR を作成しない
- テストは evaluator が PASS 時点で確認済み（PASS ありのブランチ）。再実行は不要
- コードレビューは evaluator が担当済み。ここでは再レビューしない
