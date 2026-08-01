import * as Comlink from 'comlink'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from './registerDomainErrorTransferHandler'
import { WORKER_READY_MESSAGE } from './workerReadyMessage'

/**
 * メインスレッドからWeb Worker(db.worker.ts)を起動し、Comlinkでラップした
 * 型安全なRPCクライアントを返す(docs/architecture.md 5章)。呼び出し側は
 * Remote<RepositoryRegistry>の各Repositoryメソッドを通常のPromiseベースAPIとして
 * 呼び出せる。Worker側のDB初期化(sql.jsのWASMロード)は非同期でありComlinkの
 * メッセージリスナー登録より先にRPC呼び出しを送ると応答が失われるため、Worker側が
 * 送出するWORKER_READY_MESSAGEを待ってからComlink.wrap()する。ブラウザのWorker/
 * postMessageに依存するためNode/Vitestでは検証できず、Playwright(実ブラウザ)で
 * テストする(計画Issue #24)。
 */
export function createDbClient(): Promise<Comlink.Remote<RepositoryRegistry>> {
  registerDomainErrorTransferHandler()

  const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
    type: 'module',
  })

  return new Promise((resolve) => {
    function handleReady(event: MessageEvent): void {
      if (event.data?.type === WORKER_READY_MESSAGE.type) {
        worker.removeEventListener('message', handleReady)
        resolve(Comlink.wrap<RepositoryRegistry>(worker))
      }
    }
    worker.addEventListener('message', handleReady)
  })
}
