前セッションの続きから作業を再開してください。

## 手順

### 1. 計画 Issue を特定する

ユーザーから計画 Issue 番号を受け取る。または現在のブランチ名から推測する：

```bash
git branch --show-current
# 例: feature/issue-62-date-range → gh issue list で "Plan:" タイトルの Issue を探す
gh issue list --state open --search "Plan:" --limit 20
```

### 2. 計画 Issue の現在の状態を確認する

```bash
gh issue view <計画 Issue 番号>
gh issue view <計画 Issue 番号> --comments
```

最新コメントを読んで現在のフェーズを判定する：

| 最新コメントの状態 | 現在地 | 次のアクション |
|---|---|---|
| コメントなし | 計画作成済み・未実装 | `/develop <Issue番号>` を実行する（Attempt 1） |
| `## Implementation Attempt N` が最新 | 実装済み・未評価 | `@evaluator` を呼ぶ |
| `## Human Pre-Review - REWORK` が最新 | 人間による差し戻し（評価前） | 修正後に `/impl-comment` → `@evaluator` の順で進むよう案内する |
| `## Review Attempt N` + `判定: FAIL` | 差し戻し中 | 試行回数を確認し `/develop <Issue番号>` を実行する（Attempt N+1） |
| `## Review Attempt N` + `判定: PASS` | 評価通過済み | `/pr` を実行する |
| `## Human Override - REJECT` が最新 | 人間によるリジェクト（評価後） | FAIL と同様に扱う。試行回数を確認し `/develop` を案内する |

### 3. 状態をユーザーに報告して次のアクションを案内する

例：
- 「Issue #63 は Attempt 2 が評価中です。`@evaluator` を呼んでレビューを再開してください。」
- 「Issue #63 は evaluator の PASS 済みです。`/pr` を実行して PR を作成してください。」

差し戻し3回を超えている場合は「試行回数が上限に達しています。計画 Issue の見直しを検討してください。」と伝える。

## 注意事項

- resume はアクションを実行しない。状態確認と案内のみ
- 実装・評価・PR 作成は各エージェント・コマンドに委譲する
