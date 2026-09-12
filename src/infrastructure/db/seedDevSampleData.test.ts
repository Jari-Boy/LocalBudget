/**
 * seedDevSampleData の統合テスト(計画Issue #101、取引先・プロジェクト投入は計画Issue #107)。
 * npm run devでの初回起動直後から一覧表示・集計・グラフ等のUI動作確認ができるよう、
 * journal_entriesが0件の場合に少数の口座(DEV_SAMPLE_ACCOUNTS: 現金・普通預金・
 * クレジットカード)・取引先(DEV_SAMPLE_COUNTERPARTIES)・プロジェクト(DEV_SAMPLE_PROJECTS)と
 * 直近1ヶ月分の数件のダミー仕訳(DEV_SAMPLE_JOURNAL_ENTRIES)を自動投入することを検証する。
 * 貸借バランス・冪等性(journal_entries 0件判定)・投入される口座のis_reconcilable値・
 * 取引先/プロジェクトのPL行への紐付け(docs/domain/counterparties.md 1.2、
 * docs/domain/projects.md 1.2)を検証する。
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
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'
import { seedDevSampleData } from './seedDevSampleData'
import {
  DEV_SAMPLE_ACCOUNTS,
  DEV_SAMPLE_COUNTERPARTIES,
  DEV_SAMPLE_JOURNAL_ENTRIES,
  DEV_SAMPLE_PROJECTS,
} from './devSampleData'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let counterpartyRepository: SqlJsCounterpartyRepository
let projectRepository: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedDefaultHouseholdMember(db)
  seedDefaultAccounts(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  counterpartyRepository = new SqlJsCounterpartyRepository(db)
  projectRepository = new SqlJsProjectRepository(db)
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

  it('journal_entriesが0件の場合、DEV_SAMPLE_COUNTERPARTIESで定義した取引先をすべて投入する', () => {
    seedDevSampleData(db)

    const names = counterpartyRepository.findAll().map((counterparty) => counterparty.name)
    for (const seed of DEV_SAMPLE_COUNTERPARTIES) {
      expect(names).toContain(seed.name)
    }
  })

  it('journal_entriesが0件の場合、DEV_SAMPLE_PROJECTSで定義したプロジェクトをすべて投入する', () => {
    seedDevSampleData(db)

    const projects = projectRepository.findAll()
    for (const seed of DEV_SAMPLE_PROJECTS) {
      const project = projects.find((candidate) => candidate.name === seed.name)
      expect(project).toBeDefined()
      expect(project!.kind).toBe(seed.kind)
    }
  })

  it('取引先が費用側・収益側それぞれ少なくとも1件、既存ダミー仕訳のPL行に紐付いている(docs/domain/counterparties.md 1.2、1.6)', () => {
    seedDevSampleData(db)

    const accountCategoryById = new Map(accountRepository.findAll().map((account) => [account.id, account.category]))
    const linesWithCounterparty = journalEntryRepository
      .findAll()
      .flatMap((entry) => entry.lines)
      .filter((line) => line.counterpartyId !== null)
    const categories = new Set(linesWithCounterparty.map((line) => accountCategoryById.get(line.accountId)))

    expect(linesWithCounterparty.length).toBeGreaterThan(0)
    expect(categories).toContain('expense')
    expect(categories).toContain('revenue')
  })

  it('取引先はPL科目(収益・費用)の行にのみ紐付き、資産・負債の行には紐付かない(docs/domain/counterparties.md 1.2)', () => {
    seedDevSampleData(db)

    const accountCategoryById = new Map(accountRepository.findAll().map((account) => [account.id, account.category]))
    const linesWithCounterparty = journalEntryRepository
      .findAll()
      .flatMap((entry) => entry.lines)
      .filter((line) => line.counterpartyId !== null)

    for (const line of linesWithCounterparty) {
      const category = accountCategoryById.get(line.accountId)
      expect(category === 'revenue' || category === 'expense').toBe(true)
    }
  })

  it('プロジェクトが既存ダミー仕訳の1件以上のPL行に紐付いている', () => {
    seedDevSampleData(db)

    const linesWithProject = journalEntryRepository
      .findAll()
      .flatMap((entry) => entry.lines)
      .filter((line) => line.projectId !== null)

    expect(linesWithProject.length).toBeGreaterThan(0)
  })

  it('journal_entriesが既に1件以上存在する場合、取引先・プロジェクトも投入しない(冪等)', () => {
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

    expect(counterpartyRepository.findAll()).toHaveLength(0)
    expect(projectRepository.findAll()).toHaveLength(0)
  })

  it('2回連続で呼び出しても取引先・プロジェクトが重複して投入されない', () => {
    seedDevSampleData(db)
    seedDevSampleData(db)

    expect(counterpartyRepository.findAll()).toHaveLength(DEV_SAMPLE_COUNTERPARTIES.length)
    expect(projectRepository.findAll()).toHaveLength(DEV_SAMPLE_PROJECTS.length)
  })
})
