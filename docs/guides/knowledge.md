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

## sql.jsのdb.export()はlast_insert_rowid()をリセットする副作用を持つ

**内容**: sql.jsの`Database#export()`(DB全体をシリアライズして`Uint8Array`を返すAPI)を呼び出すと、同一のDB接続上でSQLiteが内部的に保持する`last_insert_rowid()`の値がリセットされる。実機テストで`db.run('INSERT ...')` → `db.export()` → `db.exec('SELECT last_insert_rowid()')`という順に実行すると、直前のINSERTで採番された値ではなく`0`が返ることを確認した。これはsql.js/SQLiteの一般的なドキュメントには明記されていない挙動で、既存のほぼ全Repositoryの`create()`実装が`db.run(INSERT...)`直後に`last_insert_rowid()`を読む規約になっているため、`export()`を書き込み処理の直後に同期的に呼ぶ実装(例: DB変更を監視して自動保存する仕組み)を書くとRepository層が広範囲に壊れる。対策として、`export()`の呼び出しを`queueMicrotask`等でマイクロタスクへ遅延させ、呼び出し元の同期処理(sql.jsのRepositoryメソッドは同期API)が完全に終わった後にのみ実行するようにする。
**参考**: `src/infrastructure/storage/withAutoSave.ts`、`docs/guides/patterns.md`「sql.jsのdb.export()を書き込み処理の直後に同期的に呼ぶと、last_insert_rowid()に依存する既存コードが壊れる」、`docs/decisions.md`「sql.jsのdb.export()はqueueMicrotaskで遅延実行し、Repositoryのcreate()実装が依存するlast_insert_rowid()を壊さないようにする」、Issue #25

## FileSystemWritableFileStreamは書き込み失敗後にclose()を呼ぶと元のエラーではなく別のTypeErrorで拒否される

**内容**: `FileSystemFileHandle#createWritable()`が返す`FileSystemWritableFileStream`(WHATWG Streams仕様の`WritableStream`を継承)で`write()`が失敗すると、ストリームは内部的にerrored状態になる。この状態で`close()`を呼んでもwrite失敗時の元のエラー(例: ディスク容量不足に相当するエラー)は再送出されず、Streams仕様に基づく別の`TypeError`(「ストリームは既にerrored」の旨)で拒否される。`try { await writable.write(x); await writable.close() } finally {...}`のように無条件でclose()を呼ぶ構造だと、この`TypeError`が本来伝播すべき元のエラーを上書きしてしまう。失敗時は`close()`ではなく`abort()`を呼ぶ必要がある(`abort()`はストリームの状態に関わらず正常に完了する)。
**参考**: `src/infrastructure/storage/databaseFileCodec.ts`(`writeDatabaseToFileHandle`)、`docs/guides/patterns.md`「try/finally構造でストリームの後始末を書くと、close()失敗時のエラーが元のエラーを上書きしてしまう」、`docs/decisions.md`「FileSystemWritableFileStreamへのwrite()が失敗した場合、close()ではなくabort()を呼び元のエラーをそのまま伝播させる」、Issue #57

## FileSystemDirectoryHandle/FileSystemFileHandleはstructured cloneに対応しておりIndexedDBにそのまま保存できる

**内容**: File System Access APIの`FileSystemDirectoryHandle`・`FileSystemFileHandle`はstructured clone可能なオブジェクトとして仕様上定義されており、`IDBObjectStore#put()`にハンドルオブジェクトをそのまま渡してIndexedDBへ保存できる(JSONシリアライズや独自の永続化フォーマットへの変換は不要)。取り出したハンドルはブラウザ再起動後も引き続き有効(ユーザーが明示的に許可を取り消さない限り)だが、`queryPermission`/`requestPermission`による読み書き権限は毎回のセッションで再確認する必要がある(次項参照)。この性質により、`directoryHandleStore`は`IndexedDBStorageAdapter`と同じ「単一object store・単一固定キーへのget/put」パターン(`indexedDbSingleRecordStore`)をそのまま流用でき、保存対象がバイト列かハンドルオブジェクトかで実装を分岐させる必要がない。
**参考**: `src/infrastructure/storage/directoryHandleStore.ts`、`src/infrastructure/storage/indexedDbSingleRecordStore.ts`、Issue #57

## FileSystemHandle#queryPermissionが'denied'を返す場合、requestPermissionを呼んでも意味がない

**内容**: MDNのドキュメントによれば、`FileSystemHandle#queryPermission()`が`'denied'`を返した状態では、以後同じハンドルに対する操作は(再度`requestPermission()`を呼んでも)すべて拒否される。`'prompt'`(未確認)の場合のみ`requestPermission()`でユーザーに許可を求める意味がある。この区別をせず`'granted'`以外は常に`requestPermission()`を呼ぶ実装にすると、`'denied'`のケースで不要なAPI呼び出しが発生する(ユーザーへのプロンプトは表示されず即座に`'denied'`が返る点で実害は小さいが、無駄な分岐でありテストでも区別して検証すべき)。
**参考**: `src/infrastructure/storage/ensureReadWritePermission.ts`、Issue #57

## Playwrightで`showDirectoryPicker`(File System Access API)をテストするにはOrigin Private File Systemのハンドルで差し替える

**内容**: `showDirectoryPicker()`は実際のOSネイティブなディレクトリ選択ダイアログを開きユーザー操作を要求するAPIであり、Playwrightから直接自動操作(ダイアログのクリック等)することはできない。しかし`window.showDirectoryPicker`はテスト内で`page.evaluate()`から任意の関数に差し替え可能な単なるグローバル関数であるため、`window.showDirectoryPicker = async () => navigator.storage.getDirectory()`のようにOrigin Private File System(OPFS)のルートハンドルを返す関数に差し替えることで、ダイアログ操作を経由せずに本物の`FileSystemDirectoryHandle`を取得できる。OPFS由来のハンドルもローカルディスクのハンドルと同一の`FileSystemDirectoryHandle`インターフェース(structured clone対応・`getFileHandle`・`queryPermission`/`requestPermission`等)を実装しているため、ディレクトリ選択(ダイアログ操作)以外の挙動、すなわちIndexedDBへの永続化・実際のファイル読み書き・権限確認フローはすべて実ブラウザのネイティブ実装で検証できる。IndexedDB・File System Access APIともにNode/jsdom環境には実装がないため、この種のテストはPlaywright(実ブラウザ)でのみ再現可能である。
**参考**: `e2e/file-system-access-storage-adapter.spec.ts`、`docs/architecture.md` 10章、Issue #57

## Comlink越しに公開するオブジェクトのプロパティが「メソッドを持つオブジェクト」の場合もComlink.proxy()が必要

**内容**: 既知の「Comlink越しにRepositoryインスタンス等『メソッドを持つオブジェクト』を引数として渡すことはできない」制約(前項)とは別に、`Comlink.expose()`する側のオブジェクト(例: `RepositoryRegistry`)自体のネストしたプロパティとして「メソッドを持つオブジェクト」を追加する場合にも、同種の問題が起きる。Comlinkの型定義上、ネストしたプロパティは既定で構造化複製可能な値(`Promisify<T>`、TypeScript上は単に`Promise<T>`)とみなされ、メソッド呼び出しの中継対象(`Remote<T>`)としては扱われない。`Comlink.proxy(value)`で明示的にProxyMarkedを付与したオブジェクトを返すことで、そのプロパティ経由のメソッド呼び出しがRPC越しに中継されるようになる(型も`Remote<T>`相当になる)。この問題は「引数として渡せない」問題と発生条件・症状が似ている(どちらも「メソッドを持つオブジェクトをComlinkでそのまま扱おうとすると壊れる」)ため、対処法(縮小シグネチャのラッパーAPI化 vs. `Comlink.proxy()`付与)を取り違えて比較しないよう注意が必要(実際に本Issueの実装当初、docstringでこの2つを「同種の制約」と誤って説明し、evaluatorレビューで指摘・訂正された)。
**参考**: `src/infrastructure/rpc/createRepositoryRegistry.ts`(`RepositoryRegistry.autoSave: AutoSaveController & Comlink.ProxyMarked`)、`docs/decisions.md`「RepositoryRegistryにRPC越しに公開するメソッド持ちオブジェクト(AutoSaveController)を追加する際、Comlink.proxy()でProxyMarkedを付与する」、Issue #58 Review Attempt 1(evaluator LOW指摘・Attempt 2で訂正)

## vite-plugin-pwaでinjectRegisterとuseRegisterSWを併用すると二重登録になりupdatefoundが検出できない

**内容**: `vite-plugin-pwa`の`injectRegister`オプションは既定値`'auto'`で、ビルド後のHTMLに独立したService Worker登録スクリプト(`registerSW.js`)を自動注入する。この状態で`virtual:pwa-register/react`の`useRegisterSW`フックをアプリケーションコード側からも呼び出すと、同一オリジンに対してSW登録が2回行われる。実機検証(本番ビルド+`vite preview`)の結果、この二重登録状態では新しいService Workerを検出した際の`updatefound`イベントが`useRegisterSW`側のリスナーで正しく発火せず、`needRefresh`が更新されない(更新確認UIが表示されない)ことを確認した。`useRegisterSW`等アプリケーションコード側でSW登録を明示的に行うフレームワーク統合を使う場合は、`injectRegister: false`を指定してHTMLへの自動注入を無効化し、登録経路を一本化する必要がある。
**参考**: `vite.config.ts`(`injectRegister: false`)、`src/components/UpdateBanner.tsx`、`docs/decisions.md`「vite-plugin-pwaのSW登録はinjectRegister: falseに固定し、useRegisterSW側に一本化する」、Issue #28

## Service Worker自身のスクリプト取得リクエストはPlaywrightのpage.route/context.routeでインターセプトできない

**内容**: Service Workerが自身の更新チェック(`registration.update()`)のために発行する、SWスクリプト自体(`sw.js`等)への取得リクエストは、ブラウザ内部のService Workerプロセスが直接発行するため、Playwrightの`page.route()`・`context.route()`いずれのネットワークインターセプションの対象にもならない(実機検証で、ルートハンドラの`intercepted`フラグが一度も`true`にならないことを確認した)。SWスクリプトの内容を書き換えて「新しいバージョンがデプロイされた」状態をE2Eテストで模擬する必要がある場合は、ネットワークインターセプトではなく、ビルド済み成果物のファイル(`dist/sw.js`)自体を`fs.writeFileSync`等で直接書き換える方式を使う。`vite preview`のような静的ファイルサーバーはリクエストの都度ファイルシステムから読み直すため、書き換え後に`registration.update()`を呼べば新しいSWとして検出される。
**参考**: `e2e/update-banner.pwa.spec.ts`・`e2e/pwa-overlay-z-index.pwa.spec.ts`、`docs/decisions.md`「Service Worker新バージョンのE2Eデプロイ模擬はdist/sw.jsの直接書き換え+registration.update()で行う」、Issue #28

## WorkboxのclientsClaimは既定でfalseのため、初回訪問時にService Workerがそのページ自身を制御下に置かない

**内容**: `vite-plugin-pwa`(Workbox)が生成するService Workerは、`workbox.clientsClaim`オプションを明示的に`true`にしない限り既定で`false`となる。この設定では、SWが初めてactivateされても、activate時点で既に開かれているページ(SW登録前から表示されていたページ、すなわち初回訪問時のページ自身)を即座に制御下(`navigator.serviceWorker.controller`)には置かない。制御下に入るのは次のナビゲーション(`page.reload()`等)以降になる。オフライン起動やSW更新をE2Eで検証する際は、`page.goto('/')`の直後ではなく、`navigator.serviceWorker.ready`を待ってから一度`reload()`し、`navigator.serviceWorker.controller !== null`になったことを確認してから本題の検証(オフライン化・SW更新チェック等)に進む必要がある。
**参考**: `e2e/offline-startup.pwa.spec.ts`・`e2e/update-banner.pwa.spec.ts`(`waitForServiceWorkerController`ヘルパー)、Issue #28

## TextDecoderは既定では不正なバイト列を置換文字で握りつぶすが、{fatal: true}を指定すると例外を投げる

**内容**: `new TextDecoder('utf-8').decode(bytes)`は既定(`fatal: false`)では、UTF-8として不正なバイト列(例: Shift-JISでエンコードされたバイト列)を渡してもエラーにならず、該当箇所を置換文字(U+FFFD)に置き換えてデコードを継続する。`new TextDecoder('utf-8', { fatal: true }).decode(bytes)`のように`fatal: true`を指定すると、不正なバイト列を検出した時点で`TypeError`を投げるようになる。この挙動の違いを利用し、「UTF-8として厳密デコードできるか(`fatal: true`で例外が出ないか)」だけでCSVの生バイト列がUTF-8かShift-JIS(等の非UTF-8エンコーディング)かを`try/catch`で判定できる(成功すればutf-8、例外が出れば日本の金融機関CSVで一般的なshift-jisにフォールバックする)。ASCIIのみ・空のバイト列はいずれのエンコーディングでも共通のバイト表現になるため常にutf-8側の判定で成功する。
**参考**: `src/domain/statement-import/inferEncoding.ts`、`src/domain/statement-import/inferEncoding.test.ts`、`docs/domain/statement-import.md` 1.3「例外: ドラフト生成時のエンコーディング自動判定」、Issue #48

## 実際の日本の金融機関CSV(楽天カード確定/未確定・PayPayカード・楽天銀行)のヘッダー表記パターン

**内容**: PR #66作成後(マージ前)、ユーザーが実際に保有する明細CSVで`inferMappingDefinitionDraft`を検証した結果、以下のヘッダー表記パターンが判明した。(1) クレジットカード明細では「利用金額」列に加えて「11月支払金額」のような月次内訳列も見出しに「金額」を含むため、キーワード「金額」だけでは複数列に曖昧にマッチする。より具体的な「利用金額」を優先させる必要がある。(2) 日付列は「ご利用日」という敬語接頭辞付きの表記のカードと、接頭辞のない「利用日」表記のカード(例: PayPayカード)が混在する。(3) 摘要列は「利用店名・商品名」という表記も存在する。(4) 銀行明細(楽天銀行)では、入金・出金が別列ではなく単一の符号付き金額列(「入出金(円)」)として提供される形式があり、ヘッダー文言自体には「出金」「入金」いずれのキーワードも含まれないため、ヘッダーマッチングだけでは列の意味を判定できず値の型(数値かどうか)に頼らざるを得ない。この形式では、`debitColumn`・`creditColumn`が(本来存在しないにもかかわらず)型フォールバック等の別経路でそれぞれ解決され、偶然同一列に収束することがある(`docs/guides/patterns.md`「複数フィールドが共通の候補プールから割り当てを行う推測ロジックで、1パスの処理順ベース実装にすると結果が処理順に依存する」の続報参照)。
**参考**: `src/domain/statement-import/columnKeywordDictionary.ts`、`src/domain/statement-import/inferMappingDefinitionDraft.test.ts`(実データ構造を模した架空fixture、実データ自体はコミットしていない)、`docs/decisions.md`「columnKeywordDictionaryはキーワードの配列ではなく階層(tier)の配列として持ち、より具体的なキーワードを広いキーワードより先に試す」、コミット9ec2454、Issue #48

## CSPのscript-srcで'wasm-unsafe-eval'を指定しないと、sql.js(WebAssembly.instantiate)がCompileErrorでAbortする

**内容**: Content-Security-Policyで`script-src 'self'`のみを設定した状態でsql.js(SQLite WASM)を初期化すると、`WebAssembly.instantiate`が`CompileError`でAbortし、WASMのコンパイル自体が失敗する。任意のJS文字列の動的実行(`eval`/`new Function`等)を許可する`'unsafe-eval'`とは別に、WASMのコンパイル・実行のみを許可する`'wasm-unsafe-eval'`という専用のCSPソース式が存在し、`script-src`にこれを追加する必要がある。`'wasm-unsafe-eval'`は`'unsafe-eval'`と異なり任意JS文字列の実行を許可しないため、CSPが本来防ぎたい「任意コード注入によるXSS」への防御は保ったままWASM実行だけを許可できる。この挙動は`e2e/backup-export-import.spec.ts`が生成する独立した検証用sql.jsインスタンスの実機テストで発見・再現確認した(既存のCSP無し環境では顕在化せず、CSP metaタグを追加して初めて判明した)。
**参考**: `index.html`(CSP metaタグ、`script-src 'self' 'wasm-unsafe-eval'`)、`e2e/csp.spec.ts`、`docs/decisions.md`「CSPはHTTPヘッダーではなくindex.htmlのmetaタグとして配信し、script-srcに'wasm-unsafe-eval'を含める」、Issue #30

## Vite dev serverはCSSモジュールのHMRで<style>タグを動的注入するため、style-src未指定のCSPだとdev server実行時のみ違反になる

**内容**: Vite dev server(`vite dev`)は、CSSモジュールのHot Module Replacement(HMR)を実現するため、JavaScriptから`<style>`タグをDOMへ動的に注入する。CSPで`style-src`を明示的に指定していない場合、`default-src 'self'`にフォールバックし`'unsafe-inline'`が許可されないため、このインライン注入がCSP違反として検出される。この挙動は本番ビルド(`vite build`)には存在しない。本番ビルドではCSSがビルド時に外部ファイルとして出力され、HMRの仕組み自体（開発時専用の機能）が含まれないため、`style-src`を指定していないCSPのままでも違反にならない。この非対称性(dev server限定の制約)への対処として、`command === 'serve'`時のみCSPを緩和するViteプラグインを追加し、`vite.config.ts`側でのみ`style-src`を緩めることで、本番ビルドのCSPを厳格なまま保つことができる。
**参考**: `vite.config.ts`(`relaxCspForDevServer`、`apply: 'serve'`)、`docs/decisions.md`「Vite dev server限定でCSPのstyle-srcを緩和するプラグイン(relaxCspForDevServer)を追加する」、Issue #30

## ComlinkのRemoteオブジェクトはtypeofが'function'と判定されるProxyであり、Reactのstate setterに直接渡すと更新関数として誤呼び出しされる

**内容**: Comlinkの`Comlink.wrap()`が返す`Remote<T>`オブジェクトは、内部実装上`function(){}`をターゲットにした`Proxy`として生成されている(メソッド呼び出し自体を関数呼び出しとして中継できるようにするため)。この結果、`typeof remoteObject === 'function'`は`true`を返す。Reactの`useState`が返すセッター関数は、引数が関数型である場合、それを「直前の状態を受け取り新しい状態を返す更新関数」とみなして`updater(prevState)`のように呼び出す仕様(functional updates)を持つため、Comlinkの`Remote<T>`オブジェクトをそのまま`setState(remoteObject)`のように渡すと、Reactが`remoteObject(prevState)`という意図しない呼び出しを行ってしまう。これはComlink側から見ると、引数無しの関数呼び出し(`path: []`のAPPLYメッセージ)がWorkerへ送信されることに相当し、対応する実体が無いため`rawValue.apply is not a function`のような実行時エラーになる。回避策は`setState(() => remoteObject)`のように関数でラップし、Reactに関数呼び出しをさせず値として保持させること。この問題はモックを使うNode/Vitestのユニットテストでは再現せず、実ブラウザ(Playwright)でComlinkのRemoteオブジェクトを実際に生成し、それを`useState`に保持するコンポーネントを操作して初めて発覚する。
**参考**: `src/infrastructure/rpc/DbClientProvider.tsx`、`docs/decisions.md`「ComlinkのRemoteオブジェクトをReactのuseStateへ渡す際は関数でラップする(setState(() => value))」、`docs/guides/patterns.md`「ComlinkのRemoteオブジェクト(typeofが'function'と判定されるProxy)をReactのuseStateにそのまま渡すと誤動作する」、Issue #31

## e2e/配下はtsconfig.app.jsonのinclude対象外のため、npm run typecheckの型チェックを受けない

**内容**: `tsconfig.app.json`の`include`は`["src"]`のみであり、`e2e/*.spec.ts`はこの対象に含まれない。`npm run typecheck`(`tsc -p tsconfig.app.json --noEmit`)は`src`配下のみを検査するため、`e2e/`配下のPlaywrightテストコードに存在する型エラーはCIの型チェックでは検出されない(Playwright自体はテストランナーが型注釈を無視して直接実行するため、テストの実行自体には影響しない)。この性質により、例えば`e2e/worker-rpc.spec.ts`の`client.account.create(...)`(Comlinkの型定義上`client.account`は`Comlink.proxy()`が付与されていないため`Promisify<AccountRepository>`= `Promise<AccountRepository>`と推論され、本来`.create`は存在しないはずの型)が、実際にはTypeScriptの型チェックに一度も晒されずに動作し続けている。同じ`RepositoryRegistry`の未`Comlink.proxy()`プロパティ(`account`等)を`src/`配下(型チェック対象)のコンポーネントから初めて呼び出そうとした際(Issue #31の`App.tsx`)に、この型エラーが初めて表面化した。
**参考**: `tsconfig.app.json`、`playwright.config.ts`、`src/App.tsx`(`Comlink.Remote<T>`型アサーション)、`docs/decisions.md`「App.tsxではRepositoryRegistryの未Comlink.proxy()プロパティをComlink.Remote<T>型アサーションで扱う」、Issue #31

## 楽天カード・楽天銀行・PayPayカードの組み込みマッピング定義に採用した実際のCSVヘッダー・列構成

**内容**: Issue #48で判明したヘッダー表記パターン(「実際の日本の金融機関CSV(楽天カード確定/未確定・PayPayカード・楽天銀行)のヘッダー表記パターン」参照)を踏まえ、Issue #76の組み込みマッピング定義(`src/infrastructure/db/builtInMappingDefinitions.ts`)では以下の具体的な列名・書式を採用した。楽天カード(確定/速報共通): 日付列「利用日」(`YYYY/MM/DD`)、摘要列「利用店名・商品名」、金額列「利用金額」(`single_signed`)、エンコーディング`utf-8`。楽天銀行: 日付列「取引日」(`YYYYMMDD`、区切り無し8桁)、摘要列「入出金内容」、金額列「入出金(円)」(単一の符号付き列、`single_signed`)、残高列「取引後残高(円)」、エンコーディング`shift-jis`(他の対応済みCSVと異なりUTF-8ではない)。PayPayカード(確定明細): 日付列「利用日/キャンセル日」(通常のカードと異なりキャンセル分を含む複合名の列見出し)、摘要列・金額列は楽天カードと同じ「利用店名・商品名」「利用金額」。加えて、楽天カードのCSVは末尾に日付列が空の特殊行(未確定明細のキャンセル区分見出し行、確定明細のETC利用区間情報の補足行)を含むことがあり、そのままでは`mapRowsToImportedRecords`が日付パースエラーを送出するため、ユーザー側でその範囲を除いてアップロードする必要がある(既知の制約、マッピング定義自体では解決できない)。
**参考**: `src/infrastructure/db/builtInMappingDefinitions.ts`、`src/infrastructure/db/seedBuiltInMappingDefinitions.ts`、`docs/domain/statement-import.md` 2.3節、`docs/guides/knowledge.md`「実際の日本の金融機関CSV(楽天カード確定/未確定・PayPayカード・楽天銀行)のヘッダー表記パターン」、Issue #76

## Promise.resolve(fn())はfnが同期的に投げる例外をPromiseのrejectionに変換しない

**内容**: `Promise.resolve(fn())`という式では、JavaScriptの評価順序上`fn()`が`Promise.resolve`自体の呼び出しより先に評価される(関数呼び出しの引数は、外側の関数が呼ばれる前に評価される)。`fn`が同期的に例外をthrowすると、`Promise.resolve`が呼ばれることすらなく例外がその場で伝播するため、生成されるはずだったPromiseそのものが存在せず、`.then()`/`.catch()`のいずれのハンドラも呼び出されない。この例外は通常の同期的なJS例外としてそのまま呼び出し元へ伝播する(Reactのイベントハンドラ内であれば、Reactやエラーバウンダリがキャッチしない限り未処理のままになる)。対照的に、`Promise.resolve().then(() => fn())`という書き方であれば、`fn()`の呼び出し自体が`.then()`のコールバックとしてマイクロタスクの中で実行されるため、`fn`が同期的にthrowしても非同期にthrow(reject)しても、必ずそのPromiseチェーンのrejectionとして扱われ`.catch()`で一律に捕捉できる。sql.jsのRepository実装(`SqlJsXxxRepository`)は全メソッドが同期API(`Database#run`/`#exec`を直接呼ぶ)であり、DDLのCHECK制約/TRIGGER違反時は同期的にJSの例外をthrowする設計(`docs/architecture.md` 5.1節)であるため、UI側でRepositoryメソッド呼び出しをPromiseチェーンに乗せる際にこの罠を特に踏みやすい。
**参考**: `src/components/household-member-management/HouseholdMemberManagementScreen.tsx`(コミットef2f502で`Promise.resolve(fn())`→`Promise.resolve().then(() => fn())`に修正)、`docs/guides/patterns.md`「非同期処理をPromise.resolve(fn())で開始すると、fnが同期的に投げる例外が.catch()で捕捉できない」、`docs/decisions.md`「非同期の書き込み操作は必ずPromise.resolve().then(() => fn())で開始し、Promise.resolve(fn())は使わない」、Issue #37
