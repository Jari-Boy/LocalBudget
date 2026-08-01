/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
import { createRepositoryRegistry } from '../rpc/createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from '../rpc/registerDomainErrorTransferHandler'
import { WORKER_READY_MESSAGE } from '../rpc/workerReadyMessage'

/**
 * Web Workerのエントリポイント(docs/architecture.md 5章)。sql.jsのWASM初期化は非同期のため、
 * Comlink.exposeによるメッセージリスナー登録が完了する前にメインスレッドからRPC呼び出しが
 * 届くと、応答されずに失われる(実測で確認済み)。DB初期化・マイグレーション・expose完了後に
 * WORKER_READY_MESSAGEを送出し、メインスレッド側(createDbClient)はこれを待ってから
 * Comlink.wrap()する。
 */
async function main(): Promise<void> {
  registerDomainErrorTransferHandler()

  const db = await createBrowserDatabase()
  runMigrations(db)

  const registry = createRepositoryRegistry(db)
  Comlink.expose(registry)

  postMessage(WORKER_READY_MESSAGE)
}

void main()
