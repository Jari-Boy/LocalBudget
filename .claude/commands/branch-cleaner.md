マージ済みブランチを安全に削除してください。

ローカルとリモートのマージ済みブランチを安全に削除する。スカッシュマージされたブランチも正しく検出する。

## 実行手順

1. 現在のブランチを確認する（削除対象にしない）
2. ローカルブランチ一覧を取得する
3. 各ブランチについて GitHub PR の状態を確認する
4. 安全に削除できるブランチを削除する

### ブランチ一覧取得

```bash
git branch --format='%(refname:short)'
```

### 各ブランチの安全確認

```bash
# GitHub PR の状態を確認（merged または closed）
gh pr list --state merged --json headRefName --jq '.[].headRefName'
gh pr list --state closed --json headRefName --jq '.[].headRefName'

# スカッシュマージ検出（main に取り込まれているか）
git merge-base --is-ancestor <branch> origin/main
```

### 削除

```bash
# ローカル削除
git branch -d <branch>    # 通常マージ済み
git branch -D <branch>    # スカッシュマージ済み（-D が必要）

# リモート削除（GitHub 側はマージ時に自動削除されることが多いが念のため確認）
git push origin --delete <branch> 2>/dev/null || true
```

## 削除対象の条件

- `main` ブランチは削除しない
- 現在チェックアウト中のブランチは削除しない
- GitHub PR が `merged` または `closed` になっているブランチを削除する
- PR が存在しないブランチは削除しない（未プッシュの作業中の可能性）
- 未マージコミットが存在し PR も MERGED でない場合は、ユーザーの明示的な承認なしに削除しない

## 出力フォーマット

```
## ブランチ整理結果

### 削除したブランチ
- feature/xxx (PR #N merged)
- fix/yyy (PR #N merged)

### 削除しなかったブランチ
- feature/zzz — 理由（例: PR #N が open のまま）

### 結果
削除: N ブランチ / スキップ: N ブランチ
```
