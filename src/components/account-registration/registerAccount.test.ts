/**
 * 口座登録ウィザードの確定処理(docs/domain/accounts.md 4.1〜4.3節)のユニットテスト。
 * AccountRepository/JournalEntryRepositoryのsql.js実装(Node上で動作)を用いて、
 * 資産科目の作成・種類選択によるis_reconcilable自動決定・初期残高入力時の
 * 初期残高科目(equity)+初期仕訳(source_type = 'initial_balance')の自動生成を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from '../../infrastructure/db/createTestDatabase'
import { runMigrations } from '../../infrastructure/db/migrations'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { registerAccount } from './registerAccount'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let creatorId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  creatorId = householdMemberRepository.create({ name: '自分' }).id
})

describe('registerAccount', () => {
  it('初期残高を入力しない場合、資産科目のみが作成される', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: null,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account).toMatchObject({
      category: 'asset',
      name: '三菱UFJ銀行',
      isReconcilable: true,
    })
    expect(journalEntryRepository.findAll()).toHaveLength(0)
    expect(accountRepository.findAll()).toHaveLength(1)
  })

  it('種類が現金の場合is_reconcilableはfalseになる', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'cash',
      name: '現金',
      householdMemberId: null,
      initialBalance: null,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.isReconcilable).toBe(false)
  })

  it('名義(householdMemberId)を指定して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })

    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: member.id,
      initialBalance: null,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.householdMemberId).toBe(member.id)
  })

  it('初期残高を入力した場合、口座専用の初期残高科目(equity)と初期仕訳が自動生成される', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: 100000,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    const allAccounts = accountRepository.findAll()
    const initialBalanceAccount = allAccounts.find(
      (a) => a.initialBalanceForAccountId === account.id,
    )
    expect(initialBalanceAccount).toMatchObject({
      category: 'equity',
      isSystemManaged: true,
    })

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      entryDate: '2026-08-03',
      sourceType: 'initial_balance',
      householdMemberId: creatorId,
    })
    expect(entries[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          side: 'debit',
          amount: 100000,
        }),
        expect.objectContaining({
          accountId: initialBalanceAccount!.id,
          side: 'credit',
          amount: 100000,
        }),
      ]),
    )
  })

  it('初期残高に0を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: 0,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
    expect(account.initialBalanceForAccountId).toBeNull()
  })

  it('初期残高に負数を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: -100,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('初期残高にNaN(数値変換に失敗した入力相当)を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: Number.NaN,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('初期残高にInfinityを指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      kind: 'bank',
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalance: Number.POSITIVE_INFINITY,
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
