import * as Comlink from 'comlink'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { flushOnPageHide } from './flushOnPageHide'
import { registerDomainErrorTransferHandler } from './registerDomainErrorTransferHandler'
import { waitForWorkerReadyOrTerminate } from './waitForWorkerReadyOrTerminate'

/**
 * メインスレッドからWeb Worker(db.worker.ts)を起動し、Comlinkでラップした
 * 型安全なRPCクライアントを返す(docs/architecture.md 5章)。呼び出し側は
 * Remote<RepositoryRegistry>の各Repositoryメソッドを通常のPromiseベースAPIとして
 * 呼び出せる。Worker側のDB初期化(sql.jsのWASMロード)は非同期でありComlinkの
 * メッセージリスナー登録より先にRPC呼び出しを送ると応答が失われるため、
 * waitForWorkerReadyOrTerminateでWorker側の準備完了(またはエラー)を待ってから
 * Comlink.wrap()する。初期化に失敗した場合、生成済みのWorkerはterminate()された
 * うえでこのPromiseがrejectされる(失敗したWorkerを残さない)。ブラウザのWorker/
 * postMessageに依存するためNode/Vitestでは検証できず、Playwright(実ブラウザ)で
 * テストする(計画Issue #24)。
 *
 * Worker側のwithAutoSaveはDB変更をtrailing debounce(2秒)で永続化するため(計画Issue #58)、
 * ページ非表示時にタイマーを待たず確実に保存されるよう、flushOnPageHideでdocument/windowの
 * visibilitychange/pagehideを監視し、client.autoSave.flush()をRPC越しに呼び出す。
 */
export async function createDbClient(): Promise<Comlink.Remote<RepositoryRegistry>> {
  registerDomainErrorTransferHandler()

  const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
    type: 'module',
  })

  await waitForWorkerReadyOrTerminate(worker)

  const client = Comlink.wrap<RepositoryRegistry>(worker)
  flushOnPageHide(client.autoSave, document, window)

  return client
}
