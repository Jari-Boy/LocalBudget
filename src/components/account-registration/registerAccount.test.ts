/**
 * 資産・負債の統合登録フローの確定処理(docs/domain/accounts.md 4.1〜4.3節、計画Issue #102)の
 * ユニットテスト。AccountRepository/JournalEntryRepositoryのsql.js実装(Node上で動作)を用いて、
 * category(asset/liability)・isReconcilableを直接指定した資産・負債科目の作成、初期残高入力時の
 * 初期残高科目(equity)+初期仕訳(source_type = 'initial_balance')の自動生成を検証する。
 * initialBalanceLinesは世帯メンバーごとの複数行を渡せる汎用的な配列設計だが、現在の呼び出し元
 * (AccountRegistrationFlow)は常に要素1件を渡すため、複数行のテストケースは関数自体の
 * 汎用性(過去に現金の世帯メンバーごとの初期残高入力、計画Issue #90で使われていた挙動)の
 * 回帰防止として残している。
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
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: null }],
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

  it('isReconcilable = falseを指定した場合、falseで作成される(例: 現金・外部明細なしの資産)', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: null }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.isReconcilable).toBe(false)
  })

  it('category = liabilityを指定した場合、負債科目として作成される(例: クレジットカード未払金)', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'liability',
      isReconcilable: false,
      name: '楽天カード',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: null }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account).toMatchObject({ category: 'liability', name: '楽天カード', isReconcilable: false })
  })

  it('名義(householdMemberId)を指定して作成できる', async () => {
    const member = householdMemberRepository.create({ name: '太郎' })

    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: member.id,
      initialBalanceLines: [{ householdMemberId: null, amount: null }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.householdMemberId).toBe(member.id)
  })

  it('初期残高を入力した場合、口座専用の初期残高科目(equity)と初期仕訳が自動生成される', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 100000 }],
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
          householdMemberId: null,
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
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 0 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
    expect(account.initialBalanceForAccountId).toBeNull()
  })

  it('初期残高に負数を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: -100 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('初期残高にNaN(数値変換に失敗した入力相当)を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: Number.NaN }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('初期残高にInfinityを指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: Number.POSITIVE_INFINITY }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('世帯メンバーごとの初期残高行を複数指定した場合、メンバーごとの借方明細と合計額の貸方明細を持つ初期仕訳が生成される(計画Issue #90)', async () => {
    const taro = householdMemberRepository.create({ name: '太郎' })
    const hanako = householdMemberRepository.create({ name: '花子' })

    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [
        { householdMemberId: taro.id, amount: 5000 },
        { householdMemberId: hanako.id, amount: 3000 },
      ],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    const allAccounts = accountRepository.findAll()
    const initialBalanceAccount = allAccounts.find(
      (a) => a.initialBalanceForAccountId === account.id,
    )

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          side: 'debit',
          amount: 5000,
          householdMemberId: taro.id,
        }),
        expect.objectContaining({
          accountId: account.id,
          side: 'debit',
          amount: 3000,
          householdMemberId: hanako.id,
        }),
        expect.objectContaining({
          accountId: initialBalanceAccount!.id,
          side: 'credit',
          amount: 8000,
        }),
      ]),
    )
  })

  it('世帯メンバーごとの初期残高行の一部が0円・未入力の場合、その行の借方明細は生成されない', async () => {
    const taro = householdMemberRepository.create({ name: '太郎' })
    const hanako = householdMemberRepository.create({ name: '花子' })

    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [
        { householdMemberId: taro.id, amount: 5000 },
        { householdMemberId: hanako.id, amount: null },
      ],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    const entries = journalEntryRepository.findAll()
    expect(entries[0].lines).toHaveLength(2)
    expect(entries[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: account.id, side: 'debit', householdMemberId: taro.id }),
      ]),
    )
    expect(entries[0].lines.some((line) => line.householdMemberId === hanako.id)).toBe(false)
  })

  it('世帯メンバーごとの初期残高行がすべて0円・未入力の場合、初期残高科目・仕訳は作成されない', async () => {
    const taro = householdMemberRepository.create({ name: '太郎' })
    const hanako = householdMemberRepository.create({ name: '花子' })

    await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [
        { householdMemberId: taro.id, amount: 0 },
        { householdMemberId: hanako.id, amount: null },
      ],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(accountRepository.findAll()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })
})
