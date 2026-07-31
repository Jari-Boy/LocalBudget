# 技術知見

このドキュメントは、実装を進める中で得られた技術的な知見を蓄積するものである（sql.js・Web Worker RPC・StorageAdapter・Service Worker/PWA・File System Access API 等）。
`planner` が計画時の調査で、`doc-updater` が `/pr`・`/after-pr`・`/update-docs` 実行時に参照・更新する。

更新判断:
- sql.js やインフラ層の仕様・挙動に関する新しい知見がある
- ブラウザ API（IndexedDB・File System Access・Service Worker 等）の互換性やクセに関する知見がある
- 外部連携（CSV フォーマット、同期フォルダのクライアント挙動等）の仕様が判明した

## フォーマット

```
## <トピック>

**内容**: 何がわかったか
**参考**: 関連する外部ドキュメント・Issue（あれば）
```

---

## sql.jsをNode/Vitest上で動かす際のwasmBinary生成

**内容**: `initSqlJs({ wasmBinary })`にNode.jsの`readFileSync`の戻り値をそのまま渡すと壊れたWASMとして読み込まれうる。`readFileSync`が返す`Buffer`は`Uint8Array`のサブクラスだが、その基底の`.buffer`（`ArrayBuffer`）はNodeのバッファプーリングにより実ファイルサイズより大きいことがある。`byteOffset`・`byteLength`を無視して`.buffer`をそのまま渡すと余分な領域を含んだバイト列がWASMバイナリとして扱われてしまうため、`wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength)`のように明示的に該当範囲を切り出してから渡す必要がある。
**参考**: `src/infrastructure/db/createTestDatabase.ts`

## SQLiteのCREATE TRIGGER/FK REFERENCESはテーブル参照を遅延解決する

**内容**: SQLiteでは`CREATE TABLE ... REFERENCES <table>`や`CREATE TRIGGER`本体内で参照する別テーブルが、定義時点でまだ存在していなくてもエラーにならない（参照先の名前解決はSQL実行時まで遅延される）。この性質により、`docs/schema/`配下の複数ファイルを跨いだ相互参照があっても、物理的な適用順序を厳密にDAG順にしなくても`CREATE TABLE`/`CREATE TRIGGER`文自体は成功する（例: `accounts.sql`の`prevent_delete_account_with_references`トリガーは`journal.sql`・`budgets.sql`・`recurring_transactions.sql`で後から定義される`journal_lines`・`budgets`・`recurring_transaction_rules`テーブルをEXISTS句で参照するが、`accounts.sql`はそれらより先に適用される）。ただし実際にトリガーが発火するDML実行時には参照先テーブルが存在している必要があるため、マイグレーション全体の適用が完了していることを前提にできない場面（適用途中の中間状態等）では問題になりうる。この遅延解決に依存する場合は、全ファイル適用後に参照先が期待通り存在し、トリガーが実際に機能することをテストで保証しておくとよい。
**参考**: `src/infrastructure/db/migrations.ts`のコメント、`src/infrastructure/db/migrations.test.ts`、GitHub Issue #5「懸念点」節

## Viteの`?raw`インポートはVitestでも追加設定なしで使える

**内容**: `import sql from '../../../docs/schema/accounts.sql?raw'`のように`?raw`サフィックスを付けると、Viteはファイル内容を文字列としてそのままインポートできる。Vitestは内部でViteのモジュール解決をそのまま利用するため、`vite.config.ts`とは別に`vitest.config.ts`側で追加設定をしなくても、同じ`?raw`インポートがテストコード（Node環境）からも動作する。型定義も`tsconfig`の`"types": ["vite/client"]`に含まれる`vite/client.d.ts`の`declare module '*?raw'`宣言でカバーされ、独自の`.d.ts`を書く必要がない。
**参考**: `src/infrastructure/db/migrations.ts`、`tsconfig.app.json`
