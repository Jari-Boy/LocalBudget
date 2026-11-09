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
import { SqlJsJournalEntryLinkGroupRepository } from './SqlJsJournalEntryLinkGroupRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'
import { seedDevSampleData } from './seedDevSampleData'
import {
  DEV_SAMPLE_ACCOUNTS,
  DEV_SAMPLE_COUNTERPARTIES,
  DEV_SAMPLE_HOUSEHOLD_MEMBERS,
  DEV_SAMPLE_JOURNAL_ENTRIES,
  DEV_SAMPLE_PROJECTS,
  DEV_SAMPLE_SETTLEMENT_BATCHES,
  DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES,
  DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES,
  DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES,
} from './devSampleData'
import { SqlJsSettlementBatchRepository } from './SqlJsSettlementBatchRepository'

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

  it('journal_entriesが0件の場合、DEV_SAMPLE_JOURNAL_ENTRIES・精算画面確認用の仕訳(DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES/PAYABLE_ENTRIES/REPAYMENT_CANDIDATES)の件数分だけ仕訳を投入する(計画Issue #139)', () => {
    seedDevSampleData(db)

    expect(journalEntryRepository.findAll()).toHaveLength(
      DEV_SAMPLE_JOURNAL_ENTRIES.length +
        DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES.length * 2 + // 元仕訳+割勘仕訳の2件1組
        DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES.length +
        DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES.length,
    )
  })

  it('journal_entriesが0件の場合、DEV_SAMPLE_HOUSEHOLD_MEMBERSで定義した世帯メンバーを投入する(計画Issue #139)', () => {
    seedDevSampleData(db)

    const names = new SqlJsHouseholdMemberRepository(db).findAll().map((member) => member.name)
    for (const seed of DEV_SAMPLE_HOUSEHOLD_MEMBERS) {
      expect(names).toContain(seed.name)
    }
  })

  it('journal_entriesが0件の場合、DEV_SAMPLE_SETTLEMENT_BATCHESで定義した精算バッチを投入し、取引先指定のバッチはcounterparty_idが紐づく(計画Issue #139)', () => {
    seedDevSampleData(db)

    const batches = new SqlJsSettlementBatchRepository(db).findAll()
    const counterpartyByName = new Map(counterpartyRepository.findAll().map((c) => [c.name, c.id]))
    for (const seed of DEV_SAMPLE_SETTLEMENT_BATCHES) {
      const batch = batches.find((b) => b.name === seed.name)
      expect(batch).toBeDefined()
      expect(batch!.type).toBe(seed.type)
      expect(batch!.counterpartyId).toBe(seed.counterpartyName ? counterpartyByName.get(seed.counterpartyName)! : null)
    }
  })

  it('精算画面(計画Issue #139)の「割り当て済み/未割り当て」両方のパターンが揃っている', () => {
    seedDevSampleData(db)

    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    const liabilityLines = journalEntryRepository
      .findAll()
      .flatMap((entry) => entry.lines)
      .filter((line) => line.accountId === advanceLiability.id)

    expect(liabilityLines.some((line) => line.settlementBatchId !== null)).toBe(true)
    expect(liabilityLines.some((line) => line.settlementBatchId === null)).toBe(true)
  })

  it('精算画面(計画Issue #139)で「一致」判定になる候補と「不一致」判定になる候補の両方が揃っている(世帯メンバー・立替金負債)', () => {
    seedDevSampleData(db)

    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    const spouse = new SqlJsHouseholdMemberRepository(db).findAll().find((m) => m.name === '配偶者')!
    const batches = new SqlJsSettlementBatchRepository(db).findAll()
    const allLines = journalEntryRepository.findAll().flatMap((entry) => entry.lines)

    const balanceByBatchName = new Map(
      DEV_SAMPLE_SETTLEMENT_BATCHES.filter((b) => b.counterpartyName === undefined).map((seed) => {
        const batch = batches.find((b) => b.name === seed.name)!
        const balance = allLines
          .filter(
            (line) =>
              line.settlementBatchId === batch.id && line.accountId === advanceLiability.id && line.householdMemberId === spouse.id,
          )
          .reduce((sum, line) => sum + (line.side === 'credit' ? line.amount : -line.amount), 0)
        return [seed.name, balance] as const
      }),
    )
    const unassignedTotal = allLines
      .filter(
        (line) =>
          line.accountId === advanceLiability.id && line.settlementBatchId === null && line.householdMemberId === spouse.id,
      )
      .reduce((sum, line) => sum + line.amount, 0)

    // 6月飲み会の割勘(1500円)は、未割当返済の一部(1500円)とちょうど一致する組み合わせが存在する
    expect([...balanceByBatchName.values()]).toContain(1500)
    // 7月生活費の割勘(2000円)に対し、未割当返済の合計(1500+1200=2700円)のどの組み合わせでも
    // ちょうど一致しない(不一致パターンが試せる)
    expect(balanceByBatchName.get('7月生活費の割勘')).toBe(2000)
    expect(unassignedTotal).not.toBe(0)
  })

  it('精算画面(計画Issue #139)の取引先側(未払金)のパターンが含まれる(イオンの後払い分)', () => {
    seedDevSampleData(db)

    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    const batch = new SqlJsSettlementBatchRepository(db).findAll().find((b) => b.name === 'イオンの後払い分')!
    expect(batch.counterpartyId).not.toBeNull()

    const taggedLine = journalEntryRepository
      .findAll()
      .flatMap((entry) => entry.lines)
      .find((line) => line.settlementBatchId === batch.id && line.accountId === advanceLiability.id)
    expect(taggedLine).toBeDefined()
  })

  it('投入される全ての明細行に世帯メンバーが入っている。イオンの後払い分の支払いは、支払った当人(自分)の行になる(計画Issue #169)', () => {
    seedDevSampleData(db)

    const members = new SqlJsHouseholdMemberRepository(db).findAll()
    const memberIds = new Set(members.map((m) => m.id))
    const lines = journalEntryRepository.findAll().flatMap((entry) => entry.lines)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(memberIds.has(line.householdMemberId)).toBe(true)
    }

    const myselfId = members.find((m) => m.name === '自分')!.id
    const aeonRepayment = journalEntryRepository.findAll().find((e) => e.memo === 'イオンへの後払い分の支払い')!
    const advanceLiability = accountRepository.findAll().find((a) => a.category === 'liability' && a.isSystemManaged)!
    expect(aeonRepayment.lines.find((l) => l.accountId === advanceLiability.id)?.householdMemberId).toBe(myselfId)
  })

  it('世帯メンバー間の割勘仕訳(DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES)は元仕訳と同じ関連仕訳グループに属し、「割勘の履歴」画面で辿れる状態になっている(計画Issue #139)', () => {
    seedDevSampleData(db)

    const journalEntryLinkGroupRepository = new SqlJsJournalEntryLinkGroupRepository(db)
    const splitEntry = journalEntryRepository.findAll().find((entry) => entry.memo === '飲み会代の割勘')!
    const originalEntry = journalEntryRepository.findAll().find((entry) => entry.memo === '飲み会代(全額立替)')!

    const splitGroupIds = journalEntryLinkGroupRepository.findGroupIdsForEntry(splitEntry.id)
    const originalGroupIds = journalEntryLinkGroupRepository.findGroupIdsForEntry(originalEntry.id)
    expect(splitGroupIds).toHaveLength(1)
    expect(originalGroupIds).toEqual(splitGroupIds)
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
        { householdMemberId: memberId, accountId: foodAccountId, side: 'debit', amount: 1000 },
        { householdMemberId: memberId, accountId: cashAccountId, side: 'credit', amount: 1000 },
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

    expect(journalEntryRepository.findAll()).toHaveLength(
      DEV_SAMPLE_JOURNAL_ENTRIES.length +
        DEV_SAMPLE_SETTLEMENT_SPLIT_ENTRIES.length * 2 + // 元仕訳+割勘仕訳の2件1組
        DEV_SAMPLE_SETTLEMENT_PAYABLE_ENTRIES.length +
        DEV_SAMPLE_SETTLEMENT_REPAYMENT_CANDIDATES.length,
    )
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
        { householdMemberId: memberId, accountId: foodAccountId, side: 'debit', amount: 1000 },
        { householdMemberId: memberId, accountId: cashAccountId, side: 'credit', amount: 1000 },
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
