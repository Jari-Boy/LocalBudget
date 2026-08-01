import * as Comlink from 'comlink'
import type { RepositoryRegistry } from './createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from './registerDomainErrorTransferHandler'

/**
 * メインスレッドからWeb Worker(db.worker.ts)を起動し、Comlinkでラップした
 * 型安全なRPCクライアントを返す(docs/architecture.md 5章)。呼び出し側は
 * Remote<RepositoryRegistry>の各Repositoryメソッドを通常のPromiseベースAPIとして
 * 呼び出せる。ブラウザのWorker/postMessageに依存するためNode/Vitestでは検証できず、
 * Playwright(実ブラウザ)でテストする(計画Issue #24)。
 */
export function createDbClient(): Comlink.Remote<RepositoryRegistry> {
  registerDomainErrorTransferHandler()

  const worker = new Worker(new URL('../worker/db.worker.ts', import.meta.url), {
    type: 'module',
  })
  return Comlink.wrap<RepositoryRegistry>(worker)
}
