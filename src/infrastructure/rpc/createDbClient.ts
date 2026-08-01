import * as Comlink from 'comlink'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from './registerDomainErrorTransferHandler'
import { waitForWorkerReady } from './waitForWorkerReady'

/**
 * メインスレッドからWeb Worker(db.worker.ts)を起動し、Comlinkでラップした
 * 型安全なRPCクライアントを返す(docs/architecture.md 5章)。呼び出し側は
 * Remote<RepositoryRegistry>の各Repositoryメソッドを通常のPromiseベースAPIとして
 * 呼び出せる。Worker側のDB初期化(sql.jsのWASMロード)は非同期でありComlinkの
 * メッセージリスナー登録より先にRPC呼び出しを送ると応答が失われるため、
 * waitForWorkerReadyでWorker側の準備完了(またはエラー)を待ってからComlink.wrap()する。
 * 初期化に失敗した場合はこのPromiseがrejectされる。ブラウザのWorker/postMessageに
 * 依存するためNode/Vitestでは検証できず、Playwright(実ブラウザ)でテストする
 * (計画Issue #24)。
 */
export async function createDbClient(): Promise<Comlink.Remote<RepositoryRegistry>> {
  registerDomainErrorTransferHandler()

  const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
    type: 'module',
  })

  await waitForWorkerReady(worker)

  return Comlink.wrap<RepositoryRegistry>(worker)
}
