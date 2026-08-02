/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
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
 * withAutoSaveでDB変更を即時(デバウンスなしの単純なsave呼び出し。デバウンスは計画Issue #58)
 * 永続化する。
 */
async function main(): Promise<void> {
  registerDomainErrorTransferHandler()

  const storageAdapter = new IndexedDBStorageAdapter()
  const savedData = await storageAdapter.load()

  const db = await createBrowserDatabase(savedData ?? undefined)
  runMigrations(db)
  withAutoSave(db, storageAdapter)

  const registry = createRepositoryRegistry(db)
  Comlink.expose(registry)

  postMessage(WORKER_READY_MESSAGE)
}

main().catch((error: unknown) => {
  postMessage(createWorkerInitErrorMessage(error))
})
