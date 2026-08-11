/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
import { seedBuiltInMappingDefinitions } from '../db/seedBuiltInMappingDefinitions'
import { createRepositoryRegistry } from '../rpc/createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from '../rpc/registerDomainErrorTransferHandler'
import { WORKER_READY_MESSAGE, createWorkerInitErrorMessage } from '../rpc/workerLifecycleMessages'
import { IndexedDBStorageAdapter } from '../storage/IndexedDBStorageAdapter'
import { withAutoSave } from '../storage/withAutoSave'

/**
 * Web Workerのエントリポイント(docs/architecture.md 5章)。sql.jsのWASM初期化は非同期のため、
 * Comlink.exposeによるメッセージリスナー登録が完了する前にメインスレッドからRPC呼び出しが
 * 届くと、応答されずに失われる(実測で確認済み)。DB初期化・マイグレーション・expose完了後に
 * WORKER_READY_MESSAGEを送出し、メインスレッド側(createDbClient/waitForWorkerReady)は
 * これを待ってからComlink.wrap()する。初期化中に例外が発生した場合はworker-init-error
 * メッセージを送出し、メインスレッド側のPromiseを無期限にハングさせず確実にrejectさせる。
 * 起動時はIndexedDBStorageAdapterから既存DBのバイト列をロードして復元し(計画Issue #25、
 * FileSystemAccessStorageAdapterへの対応・保存先切り替えは別Issue)、マイグレーション適用後
 * withAutoSaveでDB変更をtrailing debounce(計画Issue #58)で永続化する。withAutoSaveが返す
 * AutoSaveControllerはRepositoryRegistryのautoSaveキーとして公開し、メインスレッド側が
 * ページ非表示時等にRPC越しにflush()を呼べるようにする。同じstorageAdapterインスタンスは
 * バックアップのインポート(計画Issue #26)がStorageAdapterへの検証済みバイト列の保存にも
 * 使うため、createRepositoryRegistryへそのまま渡す。マイグレーション適用直後に
 * seedBuiltInMappingDefinitions(計画Issue #76、docs/domain/statement-import.md 2.3節)を
 * 呼び出し、OSS同梱の組み込みマッピング定義(楽天カード・楽天銀行・PayPayカード等)を
 * account_id = NULLの汎用定義として投入する(冪等、既存定義があれば再投入しない)。
 */
async function main(): Promise<void> {
  registerDomainErrorTransferHandler()

  const storageAdapter = new IndexedDBStorageAdapter()
  const savedData = await storageAdapter.load()

  const db = await createBrowserDatabase(savedData ?? undefined)
  runMigrations(db)
  seedBuiltInMappingDefinitions(db)
  const autoSaveController = withAutoSave(db, storageAdapter)

  const registry = createRepositoryRegistry(db, autoSaveController, storageAdapter)
  Comlink.expose(registry)

  postMessage(WORKER_READY_MESSAGE)
}

main().catch((error: unknown) => {
  postMessage(createWorkerInitErrorMessage(error))
})
