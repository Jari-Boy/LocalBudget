/**
 * 資産・負債の統合登録フローの確定処理(docs/domain/accounts.md 4.1〜4.3節、計画Issue #102・#205)の
 * ユニットテスト。AccountRepository/AccountBalanceRecordRepositoryのsql.js実装(Node上で動作)を用いて、
 * category(asset/liability)・isReconcilableを直接指定した資産・負債科目の作成と、
 * 「最初の残高の記録」(日付+金額、計画Issue #205で初期残高の入力を置き換えた)の保存を検証する。
 * 最初の残高の記録は、同じトランザクション内で純資産「初期残高」を相手科目とする元手の自動調整仕訳になる。
 * 取引後残高のあるCSVの科目(isReconcilable = true)は最初の明細から基準点が決まるため、記録は作らない。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountBalanceRecordRepository } from '../../infrastructure/db/SqlJsAccountBalanceRecordRepository'
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { seedBalanceAdjustmentAccount } from '../../infrastructure/db/seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { registerAccount } from './registerAccount'

let db: Database
let accountRepository: SqlJsAccountRepository
let balanceRecords: SqlJsAccountBalanceRecordRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  accountRepository = new SqlJsAccountRepository(db)
  balanceRecords = new SqlJsAccountBalanceRecordRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  householdMemberRepository.create({ name: '自分' })
})

describe('registerAccount: 科目の作成', () => {
  it('外部明細ありの回答を保存する(CSVあり・残高なしは照合可否がfalseでも外部明細あり、計画Issue #189)', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'liability',
      name: 'カード未払金',
      householdMemberId: null,
      isReconcilable: false,
      hasExternalStatement: true,
    })

    expect(account.hasExternalStatement).toBe(true)
    expect(account.isReconcilable).toBe(false)
  })

  it('外部明細なしの回答を保存する', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      name: '現金',
      householdMemberId: null,
      isReconcilable: false,
      hasExternalStatement: false,
    })

    expect(account.hasExternalStatement).toBe(false)
  })

  it('最初の残高を入力しない場合は、科目だけが作られ仕訳は作られない', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      firstBalance: null,
    })

    expect(account).toMatchObject({ category: 'asset', name: '現金', isReconcilable: false })
    expect(journalEntryRepository.findAll()).toHaveLength(0)
    expect(balanceRecords.findByAccount(account.id)).toHaveLength(0)
  })

  it('負債科目として作成できる(例: クレジットカード未払金)', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'liability',
      isReconcilable: false,
      name: '楽天カード',
      householdMemberId: null,
    })

    expect(account).toMatchObject({ category: 'liability', name: '楽天カード', isReconcilable: false })
  })

  it('所属グループを指定して作成でき、未指定ならグループなしで作成される(計画Issue #154)', async () => {
    const group = new SqlJsAccountGroupRepository(db).create({ name: '普通預金', category: 'asset' })
    const base = { category: 'asset' as const, isReconcilable: true, householdMemberId: null }

    const grouped = await registerAccount(accountRepository, balanceRecords, {
      ...base,
      name: '楽天銀行',
      accountGroupId: group.id,
    })
    const ungrouped = await registerAccount(accountRepository, balanceRecords, { ...base, name: '三井住友銀行' })

    expect(grouped.accountGroupId).toBe(group.id)
    expect(ungrouped.accountGroupId).toBeNull()
  })

  it('名義(householdMemberId)を指定して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })

    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: member.id,
    })

    expect(account.householdMemberId).toBe(member.id)
  })
})

describe('registerAccount: 最初の残高の記録(計画Issue #205)', () => {
  it('日付と金額を入れると残高の記録が保存され、元手の仕訳(借方: 口座 / 貸方: 初期残高)が自動で入る', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance: 12000 },
    })

    expect(balanceRecords.findByAccount(account.id)).toMatchObject([{ recordDate: '2026-08-03', balance: 12000 }])
    const [entry] = journalEntryRepository.findAll()
    expect(entry).toMatchObject({ sourceType: 'auto_balance_adjustment', entryDate: '2026-08-03' })
    expect(entry.lines.find((l) => l.accountId === account.id)).toMatchObject({ side: 'debit', amount: 12000 })
  })

  it('負債の最初の残高は「借方: 初期残高 / 貸方: 負債」で記帳される', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'liability',
      isReconcilable: false,
      name: '楽天カード',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance: 30000 },
    })

    const [entry] = journalEntryRepository.findAll()
    expect(entry.lines.find((l) => l.accountId === account.id)).toMatchObject({ side: 'credit', amount: 30000 })
  })

  it('取引後残高のあるCSVの科目(isReconcilable = true)では、渡されても記録を作らない', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: true,
      name: '普通預金',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance: 12000 },
    })

    expect(balanceRecords.findByAccount(account.id)).toHaveLength(0)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it.each([
    ['負数', -1],
    ['NaN(数値変換に失敗した入力相当)', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('金額が%sの場合は、最初の残高なしとして扱う', async (_label, balance) => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance },
    })

    expect(balanceRecords.findByAccount(account.id)).toHaveLength(0)
  })

  it('金額が0でも、その日の残高0の基準点として記録する(元手の仕訳は入らない)', async () => {
    const account = await registerAccount(accountRepository, balanceRecords, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance: 0 },
    })

    expect(balanceRecords.findByAccount(account.id)).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('残高の記録のRepositoryを渡さない使い方では、最初の残高を無視して科目だけを作る', async () => {
    const account = await registerAccount(accountRepository, null, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      firstBalance: { date: '2026-08-03', balance: 12000 },
    })

    expect(account.name).toBe('現金')
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
