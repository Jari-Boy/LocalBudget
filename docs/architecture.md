# アーキテクチャ方針

このドキュメントは、ローカル家計簿PWAの全体アーキテクチャ方針を定めるものである。実装に着手する前に技術選定とその理由・トレードオフを明文化し、以後の設計判断の拠り所とする。

## 1. 目的とスコープ

- 家計簿データをサーバーと通信せずユーザーのブラウザ内に保持し、ユーザー側にデータ主権を持たせるWebアプリを構築する。
- 本ドキュメントはアーキテクチャ方針の確定を目的とし、実装は別タスクとして扱う。
- 対象プラットフォームはPWA（ブラウザ上で動作し、インストール可能）。ネイティブアプリ化は対象外。
- ドメインは**複式簿記**をベースに構築する。勘定科目・仕訳等の詳細なドメインモデルは本ドキュメントの対象外とし、別ファイル（`docs/domain.md`、未作成）で定義する。本ドキュメントでは複式簿記であることが他のアーキテクチャ判断（DBスキーマ、外部明細取込、Repository層のインターフェース設計等）に与える影響のみ扱う。

## 2. 全体アーキテクチャ概要

```
起票入力
   ├─ 外部明細取込（金融機関/カード会社のCSV） → 読み取り・マッピング定義 → 仕訳レビュー画面
   └─ マニュアル起票（手入力） ─────────────────┘
                                                      │
React UI (メインスレッド、i18n対応)
   │  RPC (postMessage)
   ▼
Web Worker
   │  ├─ sql.js (SQLite WASM, インメモリDB)
   │  ├─ Repository層（Account / JournalEntry 等、複式簿記ドメインの永続化）
   │  └─ StorageAdapter (永続化先の抽象化)
   │        ├─ IndexedDBStorageAdapter   … 全ブラウザ対応・ブラウザ内保存
   │        └─ FileSystemAccessStorageAdapter … Chromium系のみ・ユーザー選択フォルダ保存
   ▼
永続化先: IndexedDB / ローカルフォルダ or クラウド同期フォルダ

Service Worker
   └─ アプリシェル（HTML/CSS/JS/WASMバイナリ/アイコン）のprecache
```

- DBの実体はWeb Worker内でsql.jsが保持するインメモリSQLiteであり、Reactのメインスレッドは直接DBに触れず、RPC経由でのみやり取りする。
- 「永続化」はDBの状態（バイト列）をどこに書き出すかの問題として`StorageAdapter`に切り出し、UI層・DBアクセス層とは独立に差し替えられるようにする。

## 3. 技術スタック一覧

| レイヤー | 採用技術 | 理由 |
|---|---|---|
| UIフレームワーク | React + TypeScript | チーム/個人の習熟、型安全性 |
| ビルドツール | Vite | 高速な開発体験、PWAプラグインの充実 |
| PWA化 | vite-plugin-pwa（Workbox） | Vite標準的な選択肢、Service Worker生成の自動化 |
| ローカルDB | sql.js（SQLite WASM） | Node/Vitest上でそのまま動作しTDDと相性が良い |
| DBアクセス | Repositoryパターン + Web Worker RPC | UIブロッキング回避、永続化方式の差し替え容易性 |
| RPCプロトコル | Comlink | postMessageの手続き的なやり取りを型安全なProxy関数呼び出しとして扱える。ドメインエラーの伝播は既定の`"throw"` transferHandlerを差し替えて拡張（詳細は`docs/decisions.md`） |
| テスト | Vitest（ユニット/統合）、Playwright（E2E） | 詳細は「10. テスト戦略」参照 |

## 4. データ永続化方式・保存先選択（ADR）

### 4.1 SQLite WASMエンジンの選定

| 観点 | sql.js + StorageAdapter（採用） | 公式 `@sqlite.org/sqlite-wasm` + OPFS |
|---|---|---|
| 永続化 | DB全体をバイト列にシリアライズし、StorageAdapter経由で保存 | OPFS上への実ファイルI/O（差分書き込み） |
| Node/Vitestでのテスト容易性 | 可能（そのままVitestで動く） | 不可（jsdomにOPFSは存在せずPlaywright必須） |
| マルチタブ | StorageAdapter側の設計次第（要検討事項として残す） | `opfs-sahpool`は単一コネクション排他ロックで2タブ目が失敗しうる |
| 大規模DBでの書き込み性能 | DB全体シリアライズのため劣化しやすい | 差分書き込みで高速 |

**決定**: MVPでは`sql.js`を採用する。CLAUDE.mdが要求するTDD（テストファイルを先に書き、red→green→refactorで進める）を、DBアクセス層も含めてNode/Vitest上で実践できることを最優先する。

**再評価トリガー条件**（以下に該当したらOPFS系への移行を検討する）:
- DBファイルサイズが大きくなり、書き込みのたびの全体シリアライズが体感できるレイテンシを生む
- 複数タブを同時に開いて編集する要求が明確に出てくる
- 真のマルチデバイス同期機能に着手し、より堅牢なファイルI/Oが必要になる

### 4.2 保存先のユーザー選択

ユーザーがDBの保存先を選べることを要件とする。選択肢は次の2系統。

1. **ブラウザのローカルストレージ（IndexedDB）** — デフォルト。全ブラウザで動作。
2. **ユーザー自身が契約する個人クラウドの同期フォルダ**（Dropbox / Google Drive / OneDrive等のデスクトップ同期クライアントが作るローカルフォルダ）— File System Access API (`showDirectoryPicker`) でユーザーがフォルダを選択し、アプリがそこにDBファイルを書き込む。OS側の同期クライアントが自動的にクラウドへアップロードするため、**アプリ自体は一切外部サーバーと通信しない**という原則を保ったままクラウド保存を実現できる。

この抽象化のため、`StorageAdapter`インターフェースを定義する。

```
interface StorageAdapter {
  load(): Promise<Uint8Array | null>
  save(data: Uint8Array): Promise<void>
}
```

- `IndexedDBStorageAdapter`: IndexedDBにバイト列を保存。全ブラウザ対応。
- `FileSystemAccessStorageAdapter`: ユーザーが選択したディレクトリハンドルに対し、`FileSystemWritableFileStream`で書き込む。ディレクトリハンドルはIndexedDBに保存しておき、次回起動時に`queryPermission`/`requestPermission`で権限を再確認する。Firefox/Safari等の非対応環境では、コンストラクタが明示的なエラー（`FileSystemAccessNotSupportedError`）をスローする。**IndexedDBへの自動フォールバックは行わない**（このStorageAdapterを使うかどうかの選択・非対応環境での代替導線はUI側の責務とする。着手前にユーザーと協議の上での設計判断、詳細は`docs/decisions.md`参照）。

**ブラウザ対応状況（2026年7月時点、Web検索で確認済み）**:

| ブラウザ | `showDirectoryPicker`等のローカルディスクピッカー | 備考 |
|---|---|---|
| Chrome / Edge / Opera（デスクトップ） | 対応 | Chromium 86+ |
| Firefox | **非対応** | Mozillaが標準化上のポジションとして非対応を明言。OPFS（`navigator.storage.getDirectory`）は111+で対応 |
| Safari（macOS/iPadOS/iOS） | **非対応** | WebKitはOPFSのみ対応（15.2+）、ローカルディスクピッカーは未実装かつ対応予定なし |

この制約により、Firefox/Safariでは「フォルダを選んで自動的に書き込む」体験を提供できない。したがって、**全ブラウザ共通のフォールバックとして手動エクスポート/インポート機能が必須**となる（詳細は「8. バックアップ／エクスポート・インポート設計」）。

**データ整合性上の注意点**:
- クラウド同期フォルダへの書き込みは、OS側同期クライアントが同時にファイルを読もうとするタイミングと競合する可能性がある。書き込みはデバウンス（例: 最終更新から一定時間後、またはページ非表示時）し、頻繁な書き込みを避ける。
- 複数端末が同じ同期フォルダのDBファイルを非同期に編集すると、クラウドサービス側で「競合コピー」が生成されたり、後勝ちで上書きされデータが失われるリスクがある。この方式は「バックアップミラー」であり「リアルタイムマルチデバイス同期」ではないことをユーザーにも明示する（詳細は「9. 既知の制約・将来課題」）。

**実装状況（Issue #25）**: `StorageAdapter`インターフェース・`IndexedDBStorageAdapter`・Web Worker起動時のロードフロー（`IndexedDBStorageAdapter.load()`で復元 → マイグレーション適用 → DB変更の自動永続化開始）を実装済み。DB変更の自動永続化（`withAutoSave`）は`sql.js`の`Database#run()`を監視し、BEGIN〜COMMIT/ROLLBACKのトランザクション境界単位で`save()`を1回呼ぶ設計（トランザクション途中の保存によるクラッシュ時の不完全な永続化を避けるため）。上記のデバウンスはIssue #58で実装済み（未実装だった当時の記述は下記「実装状況（Issue #58）」に置き換え）。詳細な設計判断は`docs/decisions.md`を参照。

**実装状況（Issue #57）**: `FileSystemAccessStorageAdapter`・`isFileSystemAccessSupported`（対応環境判定関数）・`FileSystemAccessNotSupportedError`（非対応環境での明示的エラー型）・`databaseFileCodec`（DBバイト列とファイルI/O間の変換ロジック、8章参照）・`ensureReadWritePermission`（`queryPermission`/`requestPermission`による権限確認）・`directoryHandleStore`（`FileSystemDirectoryHandle`のIndexedDB永続化）を実装済み。`showDirectoryPicker`はユーザージェスチャーを要求しWindowでのみ呼び出せるため、ディレクトリの選択（`selectNewDirectory`）・復元（`restoreDirectory`）は`load`/`save`とは独立した明示的な操作として提供し、呼び出しタイミング（初回起動時の選択・起動時の復元）はUI側（別Issue）の責務としている。IndexedDBStorageAdapterと`directoryHandleStore`が個別実装していたIndexedDBの「単一object store・単一固定キーへのget/put」パターンは`indexedDbSingleRecordStore`として共通化した（evaluatorレビューでのDRY違反指摘を受けた事後リファクタ、詳細は`docs/decisions.md`）。動作検証はNode/jsdomにIndexedDB・File System Access APIの実装がないためPlaywright（実ブラウザ）で行う（`e2e/file-system-access-storage-adapter.spec.ts`、10章参照）。

**実装状況（Issue #58）**: 上記のデバウンスを実装済み。`withAutoSave`は`save()`の実行を即時から`SAVE_DEBOUNCE_MS`（2秒、統計取込・一括削除等の連続書き込みを1回にまとめつつデータ損失ウィンドウも小さく抑えるバランス値として設計協議で合意）のtrailing debounceに変更し、書き込みトランザクション境界（`scheduleSave()`）ごとにタイマーをリセットする。`AutoSaveController`に`flush()`を追加し、タイマーを待たず即座に`save()`を実行できるようにした。`withAutoSave`はWeb Worker内で動作し`document`を持たない（`visibilitychange`を直接購読できない）ため、ページ非表示の検知はメインスレッド側（`flushOnPageHide`、`createDbClient.ts`から呼び出し）に置き、`document`の`visibilitychange`（`hidden`時）と`window`の`pagehide`の両方（実際のタブ閉じ操作でどちらか一方のみが発火するブラウザ差を考慮）を購読してRPC越しに`RepositoryRegistry.autoSave.flush()`を呼び出す構成にした。`AutoSaveController`はメソッドを持つオブジェクトのため`RepositoryRegistry.autoSave`の型には`Comlink.proxy()`によるProxyMarkedの付与が必要だった（詳細は`docs/decisions.md`）。`visibilitychange`と`pagehide`がほぼ同時に発火するタブ閉じ操作等で`flush()`が重複し`storageAdapter.save()`が並行実行されることを防ぐため、`withAutoSave`内部に進行中の保存完了を待って1回だけ再実行するコアレシングガード（`inFlightSave`/`pendingRerun`）を実装済み（IndexedDBでは実害はないが、将来`FileSystemAccessStorageAdapter`配線時の同一ファイルへの並行書き込みリスクに備える）。詳細な設計判断は`docs/decisions.md`を参照。

## 5. DBアクセス層とWorker設計

- DBは必ずWeb Worker内で実行し、Reactのメインスレッドはメッセージパッシング（RPC）経由でのみアクセスする。UIをブロックしないことが目的。RPCの実装には`Comlink`を採用する。Worker側（`src/infrastructure/worker/`）で全Repositoryインスタンスを1つのレジストリオブジェクトへ集約して`Comlink.expose()`し、メインスレッド側（`src/infrastructure/rpc/`）は`Comlink.wrap()`した型安全なプロキシとして呼び出す。Worker側の初期化（sql.jsのWASMロード等、非同期）が完了する前にメインスレッドがRPC呼び出しを送ると応答が失われるため、Worker起動完了をメインスレッドが待ち合わせてからRPCクライアントを生成する（Issue #24、詳細は`docs/decisions.md`）。
- ドメインは複式簿記をベースとするため、Repository層は単純な「取引（Transaction）」ではなく、**勘定科目（Account）・仕訳（JournalEntry）・仕訳明細（借方/貸方の各行）**を中心としたインターフェース（例: `AccountRepository`、`JournalEntryRepository`）で設計する。エンティティの詳細な属性・制約（勘定科目の分類、貸借バランスの検証ルール等）は`docs/domain.md`で別途定義し、本ドキュメントでは扱わない。
- DBアクセス層のテストはこれらのRepositoryインターフェースに対して書く。sql.jsを採用しているため、Vitest上でそのまま統合テストとして記述できる。
- 起動時に`PRAGMA user_version`を用いた簡易マイグレーションランナーを実行し、スキーマバージョンを管理する。
- 将来の競合解決（マルチデバイス同期）に備え、主要テーブル（仕訳・勘定科目・予算など）には`updated_at`（更新時刻）カラムを持たせておく。現時点では競合解決ロジックは実装しないが、将来の拡張の余地を残す設計とする。

### 5.1 ドメイン層とインフラ層の分離

各集約（Account・JournalEntry等）は、10章のテスト戦略（ドメインロジックの純粋なユニットテストとDBアクセス層の統合テストを分離する）に対応させる形で、コードも次の2層に分離して配置する。

- **ドメイン層（`src/domain/<集約名>/`）**: sql.js等のインフラ依存を一切持たない、純粋なTypeScriptのみで構成する。
  - `<集約名>.ts`: エンティティ・値オブジェクトの型定義（例: `Account`、`AccountCategory`、`CreateAccountInput`、`UpdateAccountInput`）。
  - `<集約名>Repository.ts`: 永続化操作を宣言するRepositoryインターフェース（ポート）。実装の詳細（SQL文・行⇔オブジェクトのマッピング等）は含まない。
  - 貸借バランス検証のような、DBアクセスを伴わない純粋なドメインロジック（バリデーション関数等）もこの層に置く。
- **インフラ層（`src/infrastructure/db/`）**: ドメイン層のRepositoryインターフェースを`implements`する具象クラスを置く（例: `SqlJsAccountRepository`）。sql.jsを用いたSQL実行、行⇔ドメインオブジェクトのマッピング、DDL側の制約違反例外の伝播はここに閉じ込める。クラス名は使用するDB実装を冠したプレフィックス（`SqlJs`）を付け、ドメイン層のインターフェース名（`AccountRepository`）と衝突しないようにする。

この分離により、ドメインロジックのユニットテストはsql.js（Web Worker/WASM初期化を伴う重いセットアップ）に依存せず高速に実行でき、インフラ層のテストは「Repositoryインターフェースの契約をsql.js実装が満たしているか」に集中できる。Accountドメインでは元々型定義・ドメインルール・SQL実装が単一ファイル（インフラ層）に同居していたが（Issue #5）、後続の仕訳（JournalEntry）ドメインで貸借バランス検証という純粋なドメインロジックが必要になることを機に、Issue #8でこのパターンへリファクタした。**今後追加する集約（JournalEntry等）も、新規実装の時点からこのドメイン層／インフラ層の分離構成に従う。**

## 6. 状態管理・UI設計方針

- DBを唯一の情報源（Single Source of Truth）とし、Reactの状態管理ライブラリでデータを二重に保持しない。
- 読み取りクエリのキャッシュ・再検証にはTanStack Query等のキャッシュ層を用い、フィルタやモーダル開閉などUI固有の一時状態は`useState`や軽量な状態管理（Zustand等）で扱う。

## 7. PWA構成

- ビルドはVite、PWA化は`vite-plugin-pwa`（Workbox）を用いる。
- Service Workerのキャッシュ戦略は、外部通信が存在しないためアプリシェル（HTML/CSS/JS/WASMバイナリ/アイコン）のprecacheのみとし、複雑なランタイムキャッシュ戦略は不要とする。
- 更新戦略は「ユーザー確認型（prompt for update）」を採用する。自動更新はDB書き込み中の強制リロードでトランザクションを破壊するリスクがあるため避ける。
- Web App Manifestは標準構成（name/short_name/icons/display: standalone/theme_color等）とする。iOS Safariは`beforeinstallprompt`に対応しないため、「ホーム画面に追加」を促す独自UIを用意する。

**実装状況（Issue #28）**: `vite-plugin-pwa`（`strategies: 'generateSW'`、`registerType: 'prompt'`）を`vite.config.ts`に導入し、アプリシェル（HTML/CSS/JS/WASMバイナリ/アイコン）のprecacheとWeb App Manifestの生成を実装済み。`injectRegister: false`を指定し、SW登録は`src/components/UpdateBanner.tsx`が使う`virtual:pwa-register/react`の`useRegisterSW`フックに一本化した（`injectRegister`の既定`'auto'`のままだとHTMLに自動注入される登録スクリプトと`useRegisterSW`側の登録が二重に走り、`updatefound`イベントの検出が阻害されることを実機検証で確認したため、詳細は`docs/decisions.md`・`docs/guides/knowledge.md`参照）。更新確認UIは画面下部固定・非モーダルのバナー（`UpdateBanner`、`needRefresh`検出時のみ表示、「更新する」を選択するまで自動更新しない）として実装した。iOS向け誘導UIは`isIos`（User-Agent判定）・`isStandaloneDisplayMode`（`navigator.standalone`/`display-mode: standalone`判定、既にホーム画面から起動済みなら誘導不要と判定）の純粋関数（`src/infrastructure/pwa/`）と、`aria-modal="true"`のモーダルダイアログ`IosInstallPrompt`（フォーカストラップ・Escapeクローズ実装済み）として実装した。「今後表示しない」を明示的にチェックして閉じない限り、`localStorage`（`iosInstallPromptDismissal.ts`）に永続化せず再訪問のたびに再表示する。`UpdateBanner`（非モーダル、`z-index: 1000`）と`IosInstallPrompt`（モーダル、`z-index: 1100`）は同時に表示されうるため、DOM順ではなくz-indexの数値でモーダル側が常に前面に来ることを明示している（evaluatorレビュー指摘への対応、詳細は`docs/decisions.md`・`docs/guides/patterns.md`）。アイコン一式は`@vite-pwa/assets-generator`で既存の`public/favicon.svg`を唯一のソースとして機械生成した（`pwa-assets.config.ts`、本番デザイン素材は将来差し替え前提）。

## 8. バックアップ／エクスポート・インポート設計（MVP必須）

保存先選択機能のFirefox/Safari向けフォールバックとして、また全ブラウザ共通のバックアップ手段として、以下をMVPに含める。

- **エクスポート**: DBファイル全体（sql.jsのシリアライズ結果）をBlobとしてダウンロードする機能。
- **インポート**: ユーザーがファイルを選択し、DBを丸ごと置き換える機能。
- シリアライズ/デシリアライズのロジックは`FileSystemAccessStorageAdapter`と共通化し、二重実装を避ける。
- CSV/JSON形式でのトランザクションエクスポートなど、他の表計算ソフトとの相互運用性を高める機能は将来課題とする。

**実装状況（Issue #57）**: 上記の共通化を見据え、DBバイト列⇔ファイルI/O間の変換ロジックを`src/infrastructure/storage/databaseFileCodec.ts`に切り出し済み。`FileSystemAccessStorageAdapter`が使う`FileSystemFileHandle`向けの読み書き（`writeDatabaseToFileHandle`/`readDatabaseFromFileHandle`）と、Blob/File向けの汎用変換（`toDatabaseBlob`/`fromDatabaseFile`）を分離してあり、後者は将来のエクスポート（Blobダウンロード）/インポート（ファイル選択アップロード）機能（#26）からもそのまま再利用できる想定（本体のエクスポート/インポートUI自体は未実装）。

**実装状況（Issue #26）**: 上記のエクスポート/インポート機能自体（`src/infrastructure/backup/`）を実装済み。エクスポートは`downloadDatabaseBackup`が`databaseFileCodec.toDatabaseBlob`をそのまま再利用し、一時的な`<a download>`要素をDOMに追加してクリックすることでブラウザ標準のダウンロードを発火させる。インポートは`importDatabaseBackup`が担い、アップロードされたバイト列から使い捨ての一時`Database`を生成した上で、新設した`assertValidDatabaseSchema`（`sqlite_master`を直接確認し、`docs/schema/*.sql`の9ファイルそれぞれの代表テーブルが揃っているかを判定）で検証してから初めて`storageAdapter.save()`へ永続化する。検証が失敗した場合は`InvalidBackupFileError`（ドメインエラーとして`domainErrorRegistry`に登録済み、Comlink越しでも`instanceof`判定できる）を投げ、既存データへは一切書き込まない。`RepositoryRegistry`には`backup: { export(), importDatabase() }`を追加し、`db.worker.ts`から`storageAdapter`を配線した。E2Eテスト（`e2e/backup-export-import.spec.ts`）は、エクスポート、エクスポート→インポートの往復（`toDatabaseBlob`でBlob化→`File`化→`fromDatabaseFile`で読み戻す経路を経由し、シリアライズ/デシリアライズ双方の再利用を検証）、不正ファイル（パース不能なガベージ、および未マイグレーションの空DB／LocalBudgetと無関係なテーブルしか持たないDB）の拒否を検証している。

**設計上の重要な注意点（実装時に発覚）**: `assertValidDatabaseSchema`は必ず`runMigrations`より先に実行する。`runMigrations`は`PRAGMA user_version`が0（未マイグレーション）のDBに対してLocalBudgetの全テーブルを新規作成してしまうため、先に適用すると空のsql.js DBファイルや無関係なテーブルしか持たないファイルでも検証をすり抜けてしまう（実装当初はこの順序を誤り、evaluatorレビューで実機バイパスとして発覚・修正した。詳細は`docs/decisions.md`参照）。また`importDatabaseBackup`は保存直前に`AutoSaveController.flush()`（4.2節参照）を呼び、インポート直前の編集操作に由来する保留中のデバウンス保存が、インポートの保存より後に発火して上書きしてしまう競合を防いでいる（同じく`docs/decisions.md`参照）。本体のエクスポート/インポートUI（ボタン配置等）・インポート成功後の`window.location.reload()`呼び出しは引き続き別Issue（UIエントリポイント）のスコープとして未実装（前者は元々本節が明記していた前提、後者は`window`がWeb Worker内に存在せずメインスレッド側の責務として残るという設計判断による）。

## 9. 既知の制約・将来課題

- **マルチデバイス同期は「バックアップミラー」であり「リアルタイム同期」ではない**: クラウド同期フォルダ方式は複数端末の同時編集を想定しておらず、コンフリクト（競合コピー生成やデータ上書き）のリスクがある。基本は1台をメインで使い、他端末からは参照中心、または手動エクスポート/インポートで最新化する運用を前提とする。
- 真のマルチデバイス同期（差分マージ・競合解決ロジックを備えたもの）は将来検討課題とする。5章で触れた`updated_at`カラムの付与は、その際の拡張を見据えたものである。
- ブラウザの「閲覧データを削除」操作やプライベートブラウジングの終了時クリアにより、IndexedDB保存分のデータは完全に失われうる。`navigator.storage.persist()`によるストレージ永続化リクエストと`navigator.storage.estimate()`によるクォータ表示をMVPに含める。

  **実装状況（Issue #27）**: `navigator.storage.persist()`を呼び出す`requestStoragePersistence()`（`src/infrastructure/storage/requestStoragePersistence.ts`、`Promise<boolean>`で許可/拒否を返す）と、`navigator.storage.estimate()`を呼び出す`getStorageEstimate()`（同ディレクトリの`getStorageEstimate.ts`、`Promise<{ usage, quota } | null>`。仕様上省略されうる`usage`/`quota`は0にフォールバック）を実装済み。両APIはメインスレッド・Web Worker双方から利用できるグローバルAPIであり、sql.jsのDB状態や`StorageAdapter`の選択に一切依存しないため、既存の`RepositoryRegistry`によるWeb Worker RPCパターンには乗せず、独立したモジュールとして実装した。`navigator.storage`非対応環境では機能検出によりそれぞれ`false`/`null`を返す（`persist()`/`estimate()`自体は呼ばない）。`persist()`の許可/拒否はブラウザのヒューリスティック依存でPlaywrightでの拒否パス再現が困難なため、E2E（`e2e/storage-persistence.spec.ts`、10章参照）では戻り値の型のみを確認し、拒否分岐の検証はVitestのモックテストに委ねた。これらをアプリの起動シーケンスに組み込みUIへ結果を表示する統合部分（`src/App.tsx`）は、UI自体がまだVite雛形のままで統合ポイントが未実装のため、将来のUI実装Issueのスコープとして残る。

- マルチタブでの同時利用時の挙動（特にIndexedDBStorageAdapter使用時の書き込み競合）は個別に検討する。
- 暗号化は現時点で非対応。IndexedDB/ファイルシステムはOSのディスク暗号化に依存するのみで、ブラウザ自体はデータを暗号化しない。共有PCでの利用リスクがあるため、将来的にパスフレーズによるアプリロック機能を検討課題とする。

## 10. テスト戦略

CLAUDE.mdの方針（実装は必ずテストから書く。red→green→refactor、テストファイルにはファイル/関数レベルのドキュメントを必ず書く）を全レイヤーに適用する。

| レイヤー                                                       | テスト内容                                                          | ツール               |
| ---------------------------------------------------------- | -------------------------------------------------------------- | ----------------- |
| ドメインロジック（集計・カテゴリ分類・予算計算等）                                  | 純粋なTypeScript関数としてのユニットテスト（多数）                                 | Vitest            |
| DBアクセス層（Repository実装）                                      | sql.jsがNode上で動作するため、そのまま統合テストとして記述                             | Vitest            |
| UIコンポーネント（DOM描画を伴うもの）                                       | react-i18next等を経由した表示内容の検証                                     | Vitest + `@testing-library/react`。既存の`vitest.config.ts`は`environment: 'node'`のまま変更せず（sql.js関連の既存テストへの影響を避けるため）、DOM描画が必要なテストファイルの先頭に`// @vitest-environment jsdom`を付与しファイル単位でjsdom環境に切り替える（Issue #29） |
| Service Worker / マニフェスト / インストール可能性 / Web Worker起動・RPC / File System Access連携 / Storage永続化・クォータ | 少数だが重要なフロー（入力→リロード→データ確認、オフライン起動、エクスポート/インポート往復、フォルダ選択保存の往復、Worker起動・RPC疎通・ドメインエラーのinstanceof伝播・Worker初期化失敗時の挙動、ストレージ永続化リクエスト/クォータ取得がWeb Worker/RPC層に依存せず単独で呼び出せることの確認、更新確認バナー/iOS誘導ポップアップの表示分岐・永続化・フォーカス制御・両者の重なり順）のみ | Playwright（実ブラウザ）。Service Workerが本番ビルドでのみ生成されるためのオフライン起動・更新確認バナー等（`*.pwa.spec.ts`）は、ビルド済み`dist/`をpreviewサーバーで配信する専用の`playwright.pwa.config.ts`で実行し、devサーバー対象の既存e2e（`playwright.config.ts`）とは棲み分ける（Issue #28） |

## 11. セキュリティ・プライバシー方針

- サーバーが存在しないためWAF等の防御層はなく、XSSは即座に全データ漏洩に直結する。CSP（`script-src 'self'`、インラインスクリプト禁止、`dangerouslySetInnerHTML`原則禁止）を最初から厳格に設定する。
- クライアントのみで完結するアプリでは、悪意あるnpm依存関係が直接ユーザーの家計データを外部送信できてしまうため、サプライチェーンリスクが相対的に主要な脅威となる。`npm audit`の定期実行、lockfileの固定、依存追加時のレビューを方針とする。
- 暗号化については「9. 既知の制約・将来課題」を参照。MVPでは非対応。

**実装状況（Issue #30）**: `index.html`に`Content-Security-Policy`のmetaタグ（`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'self'`）を追加した。ホスティング先が未定でHTTPヘッダーでのCSP配信ができないため、metaタグを採用している（将来ホスティング先が確定しHTTPヘッダーでの配信に切り替え可能になった場合、`frame-ancestors`等metaタグでは指定できないディレクティブの追加も含めて再検討する）。`script-src`には`'wasm-unsafe-eval'`を含める必要があった。sql.js（SQLite WASM）の`WebAssembly.instantiate`は`script-src 'self'`のみでは`CompileError`でAbortすることを実機検証で確認しており、任意JS文字列の実行を許す`'unsafe-eval'`とは異なりWASM実行のみを許可する`'wasm-unsafe-eval'`であればXSS対策としての厳格さ（任意コード注入の禁止）を損なわずに済む（詳細は`docs/guides/knowledge.md`）。Vite dev serverはCSSモジュールのHMRのため`<style>`タグをJSから動的に注入し、`style-src`未指定によるCSP違反がdev server実行時のみ発生する（本番ビルドでは発生しない）ため、`vite.config.ts`に`command === 'serve'`時のみ`style-src 'self' 'unsafe-inline'`を緩和する`relaxCspForDevServer`プラグインを追加した（詳細は`docs/guides/knowledge.md`・`docs/decisions.md`）。`dangerouslySetInnerHTML`原則禁止は`.oxlintrc.json`に`react/no-danger`・`react/no-danger-with-children`を`error`として追加し、lintで機械的に強制するようにした。動作検証はCSP metaタグの内容検証と、sql.js（WASM）を使ったWorker RPCがCSP制約下でCSP違反を出さずに動作することの両方をPlaywright（実ブラウザ）で行う（`e2e/csp.spec.ts`）。サプライチェーンリスク対策として、GitHub Actionsに`lint-and-typecheck`・`test`・`e2e`・`audit`（`npm audit --audit-level=high`）の4jobからなるCI（`.github/workflows/ci.yml`、push main・pull_requestトリガー）と、依存関係に変更が無い期間も新規脆弱性を検出するための週次スケジュール実行（`.github/workflows/scheduled-audit.yml`、毎週月曜0:00 UTC + `workflow_dispatch`）を追加した。依存関係の管理方針（lockfileの固定・依存追加時のレビュー観点・`npm audit`の自動実行）は`CONTRIBUTING.md`に明文化した。

## 12. 起票方式（外部明細取込・マニュアル起票）

起票（仕訳の入力）は次の2系統を想定する。

- **外部明細取込（メイン）**: 金融機関・カード会社のマイページからダウンロードしたCSVファイルを取り込む。
- **マニュアル起票**: ユーザーが手入力で仕訳を作成する。

### 設計方針

- CSVは金融機関・カード会社ごとに列構成（日付・摘要・金額・残高等の並びや表記）が異なる。この差異を吸収するため、MVPから汎用的なマッピング設定基盤（列対応を宣言的なデータとして登録・選択できる仕組み）を導入する。当初はパーサーを金融機関ごとにハードコードする案も検討したが、Local-first・OSSという前提（[1章](#1-目的とスコープ)）では、対応金融機関を増やす作業がコードを書けるコントリビューターに限られてしまい、裾野が狭くなる。列対応・日付形式・金額の符号規則等を宣言的なデータとして表現できれば、コードを書かずに新しい金融機関へ対応でき、コントリビューションのハードルが下がる。データ駆動のマッピング定義の詳細（フィールド定義・DDL）は`docs/domain/statement-import.md`で定義する。CSVのパース自体（生テキストを行×列に分解する処理）と、行×列データをドメインのレコードへ変換するマッピング処理は分離し、将来CSV以外の表形式（TSV・Excel等）に対応する際もマッピングの仕組みを再利用できるようにしておく。PDF・API連携のような表形式でない入力への対応は本設計のスコープ外とし、将来必要になった時点で別途検討する。
- 複式簿記のドメイン上、CSVの1行（多くは「入出金明細の片側」）はそのままでは仕訳として不完全である。取り込んだCSVレコードは自動的にDBへ直接書き込むのではなく、**「インポートプレビュー／仕訳レビュー画面」を経由してから確定する**フローとする。レビュー画面では、相手勘定科目（例: 普通預金と食費）の推定・確認・修正をユーザーが行えるようにする。自動推定ロジック（過去の仕訳履歴からのカテゴリ推測等）の詳細は将来のドメイン設計課題とし、本ドキュメントでは「インポートは即時確定ではなくレビューを挟む」という設計方針のみを定める。
- CSVパース処理はファイルサイズが小さいため、まずはメインスレッドで実行する方針とする。パフォーマンス上の問題が出た場合はWeb Workerへ移す。
- マニュアル起票・外部明細取込いずれの経路でも、最終的にRepository層（5章）の`JournalEntryRepository`を通じて同一のドメインルール（貸借バランス検証等、詳細は`docs/domain/journal.md`）を適用する。入力経路によってドメインの整合性ルールが分岐しないようにする。

## 13. 国際化（i18n）方針

多言語化を見据え、当初から日本語をベースとしつつ後から言語追加できる構成とする。

- **対応言語**: MVPでは日本語のみを実装するが、将来の英語等追加を前提にi18nライブラリ（React標準的な選択肢として`react-i18next`を想定）を最初から導入し、UI文字列をハードコードしない。
- **文字列リソース**: UIコンポーネントに文字列を直書きせず、言語別のリソースファイル（例: `locales/ja/*.json`）に切り出す。
- **通貨・日付・数値のロケール対応**: `Intl.NumberFormat`/`Intl.DateTimeFormat`等のブラウザ標準APIを用いてロケールごとの表示形式を切り替える。ただし**ドメイン層・DB層では金額を表示用にロケール依存の文字列として扱わず、通貨の最小単位（例: 円なら1円単位）の整数値として保持**し、浮動小数点誤差やロケール依存の丸め処理がドメインロジックに混入しないようにする（表示直前にのみフォーマットを適用）。
- 通貨コードはISO 4217に準拠して保持し、将来の多通貨対応（現時点ではスコープ外）の余地を残す。
- ドメイン層（勘定科目名、取引摘要等）に含まれるユーザー入力データ自体の翻訳は行わない（あくまでUIラベル・システムメッセージのi18nが対象）。

> **本方針のスコープ外: 外部明細CSVのヘッダー言語**
> 本章の多言語化方針はUIラベル・システムメッセージが対象であり、[statement-import.md](./domain/statement-import.md)の`inferMappingDefinitionDraft`が使う列マッピングのキーワード辞書（`src/domain/statement-import/columnKeywordDictionary.ts`）は対象外。この辞書は日本語の金融機関CSVのヘッダー文言（「日付」「摘要」「金額」等）に一致するかどうかを判定する、i18nextを介さない別の仕組みであり、現状は日本語キーワードのみをハードコードしている（`inferMappingDefinitionDraft`もこの辞書を直接importする固定の依存で、ロケール・辞書を切り替える引数は無い）。将来、英語圏など日本語以外の金融機関CSVへの対応を本格的に検討する場合は、(1)辞書をロケールごとに分割し`inferMappingDefinitionDraft`に辞書を引数として渡せるようにする、(2)型ベースのフォールバック（日付・数値パターン）がロケールに依存する表記（例: 月日の順序、桁区切り文字）を考慮できているか見直す、の両方が必要になる。詳細な経緯は`docs/decisions.md`「columnKeywordDictionaryはキーワードの配列ではなく階層(tier)の配列として持ち…」以降のIssue #48関連エントリを参照。

**実装状況（Issue #29）**: `react-i18next`/`i18next`を導入し、`src/infrastructure/i18n/i18n.ts`で日本語（`lng: 'ja'`、`fallbackLng: 'ja'`、`defaultNS: 'common'`）を初期化した。既存の`src/infrastructure/{db,pwa,rpc,storage,worker}`という「横断的関心事はinfrastructure配下に置く」慣習に配置を合わせている。リソースファイルは名前空間ごとに分割する方針とし、本Issueでは`src/locales/ja/common.json`のみを先行して用意した。ドメイン別の名前空間（`account.json`等）は、それぞれのUI実装Issue（D1〜D10、#31〜#40）側が着手時に`resources.ja`へ追加する（使われない名前空間を先回りして作らない、詳細は`docs/decisions.md`）。通貨・日付の表示ヘルパーとして`formatCurrency`/`formatDate`（`src/infrastructure/i18n/`）を実装済み。`formatCurrency`は通貨最小単位の整数値とISO 4217通貨コード（＋任意のロケール、既定`ja-JP`）から表示用文字列を生成し、通貨ごとの小数桁数は`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`から取得するため自前の桁数テーブルを持たない（詳細は`docs/decisions.md`）。両ヘルパー共通の既定ロケール`DEFAULT_LOCALE = 'ja-JP'`は`locale.ts`に集約している。これらのヘルパーはいずれも`src/domain/`・`src/infrastructure/db/`配下からは呼び出しておらず、表示直前にのみ使う設計を維持している。完了条件の検証には本リポジトリで初めてDOM描画を伴うテスト（`@testing-library/react`、`src/infrastructure/i18n/i18nSample.test.tsx`）を追加した（テスト手法の詳細は10章参照）。
