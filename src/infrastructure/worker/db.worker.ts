/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { createBrowserDatabase } from '../db/createBrowserDatabase'
import { runMigrations } from '../db/migrations'
import { createRepositoryRegistry } from '../rpc/createRepositoryRegistry'
import { registerDomainErrorTransferHandler } from '../rpc/registerDomainErrorTransferHandler'

/**
 * Web Workerのエントリポイント(docs/architecture.md 5章)。起動時にsql.jsのDBを初期化し
 * (PRAGMA foreign_keys = ONはcreateBrowserDatabase内で設定)、マイグレーションを適用したうえで
 * 全10種のRepositoryをComlink経由でメインスレッドへ公開する。Worker自体の動作は
 * Node/Vitestでは検証できないため、Playwright(実ブラウザ)でテストする(計画Issue #24)。
 */
async function main(): Promise<void> {
  registerDomainErrorTransferHandler()

  const db = await createBrowserDatabase()
  runMigrations(db)

  const registry = createRepositoryRegistry(db)
  Comlink.expose(registry)
}

void main()
