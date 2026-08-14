/**
 * seedDevSampleDataIfDev の単体テスト(計画Issue #101)。
 * import.meta.env.DEVの真偽によって開発用ダミーデータのシード関数(seedDevSampleData)が
 * 呼び出される/呼び出されないことを検証する。db.worker.tsのmain()自体はWeb Worker環境
 * (self/postMessage等)に依存しVitestで直接インポートできないため、DEV分岐をこの独立した
 * モジュールに切り出すことでテスト可能にしている(vi.stubEnvでimport.meta.env.DEVを上書きする)。
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
})
