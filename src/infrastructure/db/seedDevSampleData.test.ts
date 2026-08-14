/**
 * seedDevSampleData の統合テスト(計画Issue #101)。
 * npm run devでの初回起動直後から一覧表示・集計・グラフ等のUI動作確認ができるよう、
 * journal_entriesが0件の場合に少数の口座(DEV_SAMPLE_ACCOUNTS: 現金・普通預金・
 * クレジットカード)と直近1ヶ月分の数件のダミー仕訳(DEV_SAMPLE_JOURNAL_ENTRIES)を
 * 自動投入することを検証する。貸借バランス・冪等性(journal_entries 0件判定)・
 * 投入される口座のis_reconcilable値を検証する。
 * seedDefaultHouseholdMember(計画Issue #88)・seedDefaultAccounts(計画Issue #96)が
 * db.worker.tsのmain()内で先に呼ばれている前提を、beforeEachで再現する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { seedDefaultAccounts } from './seedDefaultAccounts'
import { seedDefaultHouseholdMember } from './seedDefaultHouseholdMember'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { seedDevSampleData } from './seedDevSampleData'
import { DEV_SAMPLE_ACCOUNTS, DEV_SAMPLE_JOURNAL_ENTRIES } from './devSampleData'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedDefaultAccounts(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
})

describe('seedDevSampleData', () => {
  it('journal_entriesが0件の場合、DEV_SAMPLE_ACCOUNTSで定義した口座をすべて投入する', () => {
    seedDevSampleData(db)

    const names = accountRepository.findAll().map((account) => account.name)
    for (const seed of DEV_SAMPLE_ACCOUNTS) {
      expect(names).toContain(seed.name)
    }
  })

  it('投入される口座はis_reconcilable = falseで作成される', () => {
    seedDevSampleData(db)

    const seededNames = DEV_SAMPLE_ACCOUNTS.map((account) => account.name)
    const accounts = accountRepository.findAll().filter((account) => seededNames.includes(account.name))
    expect(accounts).toHaveLength(DEV_SAMPLE_ACCOUNTS.length)
    for (const account of accounts) {
      expect(account.isReconcilable).toBe(false)
    }
  })

  it('journal_entriesが0件の場合、DEV_SAMPLE_JOURNAL_ENTRIESの件数だけ仕訳を投入する', () => {
    seedDevSampleData(db)

    expect(journalEntryRepository.findAll()).toHaveLength(DEV_SAMPLE_JOURNAL_ENTRIES.length)
  })

  it('投入される仕訳はいずれも貸借バランスが取れている(docs/domain/journal.md 1.3)', () => {
    seedDevSampleData(db)

    for (const entry of journalEntryRepository.findAll()) {
      const debitTotal = entry.lines
        .filter((line) => line.side === 'debit')
        .reduce((sum, line) => sum + line.amount, 0)
      const creditTotal = entry.lines
        .filter((line) => line.side === 'credit')
        .reduce((sum, line) => sum + line.amount, 0)
      expect(debitTotal).toBe(creditTotal)
      expect(debitTotal).toBeGreaterThan(0)
    }
  })

  it('投入される仕訳の日付は基準日(today引数)から31日以内に収まる', () => {
    const today = new Date('2026-08-15T00:00:00.000Z')

    seedDevSampleData(db, today)

    for (const entry of journalEntryRepository.findAll()) {
      expect(entry.entryDate <= '2026-08-15').toBe(true)
      expect(entry.entryDate >= '2026-07-15').toBe(true)
    }
  })

  it('journal_entriesが既に1件以上存在する場合、口座・仕訳とも再投入しない(冪等)', () => {
    const memberId = new SqlJsHouseholdMemberRepository(db).findAll()[0]!.id
    const cashAccountId = accountRepository.create({
      category: 'asset',
      name: 'テスト用現金',
      isReconcilable: false,
    }).id
    const foodAccountId = accountRepository.findAll().find((account) => account.name === '食費')!.id
    journalEntryRepository.create({
      householdMemberId: memberId,
      entryDate: '2026-08-01',
      lines: [
        { accountId: foodAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    seedDevSampleData(db)

    const accountNames = accountRepository.findAll().map((account) => account.name)
    for (const seed of DEV_SAMPLE_ACCOUNTS) {
      expect(accountNames).not.toContain(seed.name)
    }
    expect(journalEntryRepository.findAll()).toHaveLength(1)
  })

  it('2回連続で呼び出しても口座・仕訳が重複して投入されない', () => {
    seedDevSampleData(db)
    seedDevSampleData(db)

    expect(journalEntryRepository.findAll()).toHaveLength(DEV_SAMPLE_JOURNAL_ENTRIES.length)
    const seededNames = DEV_SAMPLE_ACCOUNTS.map((account) => account.name)
    const accounts = accountRepository.findAll().filter((account) => seededNames.includes(account.name))
    expect(accounts).toHaveLength(DEV_SAMPLE_ACCOUNTS.length)
  })
})
