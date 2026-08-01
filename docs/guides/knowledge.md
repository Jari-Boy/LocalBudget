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

## SQLiteのINTEGER PRIMARY KEY（AUTOINCREMENTなし）はテーブルが完全に空の場合のみ採番を1から再開する

**内容**: `AUTOINCREMENT`を指定していない`INTEGER PRIMARY KEY`列は、暗黙のROWIDとして「テーブル内の現在の最大値+1」を採番する。そのため、対象テーブルに他の行が1件でも残っていれば、ある行を削除して別の行を再INSERTしても、新しく採番されるidが削除前の値と偶然一致することはない。しかし、対象テーブルが完全に空（0行）の状態から採番すると1から再開するため、「削除→再挿入でidが変わることを検証する」テストをテーブルが空の状態（他に仕訳が1件もない状態）で書くと、たまたま元のidと同じ値が採番されてしまい検証の意図が成立しなくなることがある。このようなテストを書く際は、対象以外の行（例: 別の仕訳の明細）がテーブルに存在する状態を用意し、採番される値が本当に「新しい値」であることを保証する必要がある。
**参考**: `src/infrastructure/db/SqlJsJournalEntryRepository.ts`（`update`の全削除→再挿入実装）、`src/infrastructure/db/SqlJsJournalEntryRepository.test.ts`（コミット3d78bbdのコメント）

## sql.js（SQLite）はデフォルトでautocommitモードであり、複数回の書き込みをまとめるには明示的なBEGIN/COMMITが必要

**内容**: sql.jsの`Database#run`は、明示的に`BEGIN`していない限りautocommitモードで動作し、呼び出しごとに個別にコミットされる。1つのRepositoryメソッド内であっても、複数回`db.run`でINSERT/UPDATEを発行する処理を書いただけでは、all-or-nothing（途中失敗時に先行分もロールバックされる）は保証されない。ロールバック保証が必要な処理では、対象範囲全体を`this.db.run('BEGIN')`〜`try { ...; this.db.run('COMMIT') } catch (error) { this.db.run('ROLLBACK'); throw error }`で明示的に囲む必要がある（`SqlJsJournalEntryRepository.create`/`update`で確立済みの規約）。
**参考**: `src/infrastructure/db/SqlJsJournalEntryRepository.ts`（`create`/`update`）、`src/infrastructure/db/SqlJsCounterpartyRepository.ts`（`merge`、Issue #16 Review Attempt 1でBEGIN/COMMIT忘れをFAIL指摘、コミット19cee61で修正）、`docs/guides/patterns.md`「新しいRepositoryメソッドが複数回のDB書き込みを伴う場合、確立済みのBEGIN/COMMIT/ROLLBACK規約を適用し忘れる」

## Comlinkの既定"throw" transferHandlerはカスタムErrorサブクラスのinstanceof・追加プロパティを保持しない

**内容**: Comlinkは、公開(expose)された関数の呼び出しがWorker側で例外をスローした場合、内部で`"throw"`という名前のtransferHandlerを使って例外をメインスレッド側に伝播させる。既定の実装は`error.message`/`error.name`/`error.stack`のみを転送して`Error`(またはその組み込みサブクラス)を再構築するため、アプリケーション独自のErrorサブクラス(例: `UnbalancedJournalEntryError`)は`instanceof`が成立しなくなり、コンストラクタ固有の追加プロパティ(`debitTotal`等)も失われる。Comlinkの`transferHandlers`はMapとして公開されており(`import { transferHandlers } from 'comlink'`)、`transferHandlers.set('throw', {...})`で上書きできる。ただし既定ハンドラの`canHandle`は内部シンボル(`throwMarker`)の判定に依存しており外部からは再現できないため、`canHandle`は既定のものをそのまま再利用しつつ`serialize`/`deserialize`のみをカスタム実装に差し替えると、対象外の値(通常のError・任意の値のthrow)は既定の挙動へフォールバックさせられる。
**参考**: `src/infrastructure/rpc/registerDomainErrorTransferHandler.ts`、`docs/decisions.md`「RPCプロトコルにComlinkを採用し、ドメインエラーは既定の"throw" transferHandlerを差し替えてinstanceofを保持する」、Issue #24

## Web Workerの起動直後、Comlink.exposeの前にpostMessageすると応答が失われる

**内容**: sql.jsのようなWASM初期化を含む非同期処理をWeb Worker起動時に行う場合、`new Worker(...)`の生成が完了した時点でメインスレッド側は直ちにRPC呼び出しを送れる状態になる一方、Worker側のスクリプト実行(WASM初期化等の非同期処理)はまだ完了していない。`Comlink.expose()`が呼ばれてWorker側のメッセージリスナーが登録されるより前にメインスレッドから送信されたRPC呼び出しは、応答されないまま失われる。対策として、Worker側でexpose完了後に専用のreadyメッセージをpostMessageし、メインスレッド側はこれを受信してから`Comlink.wrap()`する構成にする必要がある。このreadyメッセージはComlink自身が使うRPCメッセージ(`id`を持つ)と型で区別できる形にしておけば、Comlink側のリスナーには無視され混線しない。
**参考**: `src/infrastructure/rpc/workerLifecycleMessages.ts`・`src/infrastructure/rpc/waitForWorkerReady.ts`・`src/infrastructure/worker/db.worker.ts`、Issue #24 Implementation Attempt 1

## Comlink(postMessageの構造化複製)越しにRepositoryインスタンス等「メソッドを持つオブジェクト」を引数として渡すことはできない

**内容**: Comlink、および素のpostMessageが使う構造化複製アルゴリズムは、関数を含むオブジェクト(クラスインスタンスのメソッド等)をそのまま複製できない。あるRepositoryインターフェースのメソッドが、別のRepositoryインスタンス自体を引数に取る設計(例: `JournalEntryDraftRepository.confirm(id, journalEntryRepository)`)になっている場合、そのメソッドをそのまま`Comlink.expose()`しても、メインスレッド側から対応するRepositoryインスタンスを引数として渡す手段がない。Comlinkは`Comlink.proxy()`で関数・オブジェクトをリモート参照として明示的に渡す仕組みも提供するが、Worker側が既に当該Repositoryインスタンスを保持している場合は、exposeするAPI自体をWorker内部で結線済みの縮小されたシグネチャ(該当引数を除いたラッパー関数)に置き換える方がシンプルに解決できる。
**参考**: `src/infrastructure/rpc/createRepositoryRegistry.ts`(`JournalEntryDraftRpcApi`)、`docs/decisions.md`「RPC越しに渡せないRepositoryインスタンス引数は、レジストリ内部で結線した縮小シグネチャのラッパーAPIとして公開する」、Issue #24
