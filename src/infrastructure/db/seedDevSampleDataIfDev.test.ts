/**
 * seedDevSampleDataIfDev の単体テスト(計画Issue #101)。
 * import.meta.env.DEVの真偽によって開発用ダミーデータのシード関数(seedDevSampleData)が
 * 呼び出される/呼び出されないことを検証する。db.worker.tsのmain()自体はWeb Worker環境
 * (self/postMessage等)に依存しVitestで直接インポートできないため、DEV分岐をこの独立した
 * モジュールに切り出すことでテスト可能にしている(vi.stubEnvでimport.meta.env.DEVを上書きする)。
 * あわせて、VITE_DISABLE_DEV_SEEDが"true"の場合はDEVがtrueでも投入を抑制することを検証する。
 * これはPlaywright E2Eテスト(npm run test:e2e)がnpm run devの開発サーバーに対して実行される
 * ため、DEVモードの利便性(ダミーデータ)とE2Eテストが期待するクリーンな初期状態が衝突する
 * (計画Issue #101の懸念点で予告されていた)ことへの対応であり、playwright.config.tsの
 * webServerがこの環境変数を設定してE2Eテスト実行時のみ投入を止める(通常のnpm run devでの
 * 手動確認では引き続き投入される)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { seedDefaultAccounts } from './seedDefaultAccounts'
import { seedDefaultHouseholdMember } from './seedDefaultHouseholdMember'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { seedDevSampleDataIfDev } from './seedDevSampleDataIfDev'

let db: Database
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedDefaultAccounts(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('seedDevSampleDataIfDev', () => {
  it('import.meta.env.DEVがtrueの場合、開発用ダミーデータを投入する', () => {
    vi.stubEnv('DEV', true)

    seedDevSampleDataIfDev(db)

    expect(journalEntryRepository.findAll().length).toBeGreaterThan(0)
  })

  it('import.meta.env.DEVがfalseの場合(本番相当)、開発用ダミーデータを投入しない', () => {
    vi.stubEnv('DEV', false)

    seedDevSampleDataIfDev(db)

    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('DEVがtrueでもVITE_DISABLE_DEV_SEEDが"true"の場合、開発用ダミーデータを投入しない(E2Eテスト実行時の抑制)', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DISABLE_DEV_SEED', 'true')

    seedDevSampleDataIfDev(db)

    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
