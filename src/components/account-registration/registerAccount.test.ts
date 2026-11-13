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
import { SqlJsAccountGroupRepository } from '../../infrastructure/db/SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from '../../infrastructure/db/SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from '../../infrastructure/db/SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from '../../infrastructure/db/SqlJsJournalEntryRepository'
import { seedInitialBalanceAccount } from '../../infrastructure/db/seedInitialBalanceAccount'
import { registerAccount } from './registerAccount'

let db: Database
let accountRepository: SqlJsAccountRepository
let journalEntryRepository: SqlJsJournalEntryRepository
let householdMemberRepository: SqlJsHouseholdMemberRepository
let creatorId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  seedInitialBalanceAccount(db)
  accountRepository = new SqlJsAccountRepository(db)
  journalEntryRepository = new SqlJsJournalEntryRepository(db)
  householdMemberRepository = new SqlJsHouseholdMemberRepository(db)
  creatorId = householdMemberRepository.create({ name: '自分' }).id
})

/** 単一のシステム管理科目「初期残高」(計画Issue #143)を取得する */
function findInitialBalanceAccount() {
  return accountRepository.findAll().find((a) => a.category === 'equity' && a.name === '初期残高')!
}

/** シード済みの「初期残高」科目を除いた、ユーザーが登録した科目の一覧 */
function findRegisteredAccounts() {
  return accountRepository.findAll().filter((a) => a.name !== '初期残高')
}

describe('registerAccount: 外部明細の有無(計画Issue #189)', () => {
  const base = {
    category: 'liability' as const,
    name: 'カード未払金',
    householdMemberId: null,
    initialBalanceLines: [],
    entryDate: '2026-11-07',
  }

  it('外部明細ありの回答を保存する(CSVあり・残高なしは照合可否がfalseでも外部明細あり)', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      ...base,
      isReconcilable: false,
      hasExternalStatement: true,
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.hasExternalStatement).toBe(true)
    expect(account.isReconcilable).toBe(false)
  })

  it('外部明細なしの回答を保存する', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      ...base,
      category: 'asset',
      name: '現金',
      isReconcilable: false,
      hasExternalStatement: false,
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(account.hasExternalStatement).toBe(false)
  })
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
    expect(findRegisteredAccounts()).toHaveLength(1)
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

  it('所属グループ(accountGroupId)を指定して作成でき、未指定ならグループなしで作成される(計画Issue #154)', async () => {
    const group = new SqlJsAccountGroupRepository(db).create({ name: '普通預金', category: 'asset' })
    const base = {
      category: 'asset' as const,
      isReconcilable: true,
      householdMemberId: null,
      initialBalanceLines: [],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    }

    const grouped = await registerAccount(accountRepository, journalEntryRepository, {
      ...base,
      name: '楽天銀行',
      accountGroupId: group.id,
    })
    const ungrouped = await registerAccount(accountRepository, journalEntryRepository, {
      ...base,
      name: '三井住友銀行',
    })

    expect(grouped.accountGroupId).toBe(group.id)
    expect(ungrouped.accountGroupId).toBeNull()
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

  it('初期残高を入力した場合、単一の初期残高科目(equity)を相手科目とする初期仕訳が自動生成される', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 100000 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    const initialBalanceAccount = findInitialBalanceAccount()
    expect(initialBalanceAccount).toMatchObject({
      category: 'equity',
      name: '初期残高',
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
          householdMemberId: creatorId,
        }),
        expect.objectContaining({
          accountId: initialBalanceAccount.id,
          side: 'credit',
          amount: 100000,
        }),
      ]),
    )
  })

  it('初期残高に0を指定した場合、初期残高なしとして扱われ初期残高科目・仕訳は作成されない', async () => {
    await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: true,
      name: '三菱UFJ銀行',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 0 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(findRegisteredAccounts()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
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

    expect(findRegisteredAccounts()).toHaveLength(1)
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

    expect(findRegisteredAccounts()).toHaveLength(1)
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

    expect(findRegisteredAccounts()).toHaveLength(1)
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

    const initialBalanceAccount = findInitialBalanceAccount()

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
          accountId: initialBalanceAccount.id,
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

    expect(findRegisteredAccounts()).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(0)
  })

  it('負債の初期残高は「借方: 初期残高 / 貸方: 負債」で記帳される(符号バグの回帰防止、計画Issue #143)', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'liability',
      isReconcilable: true,
      name: '楽天カード',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 30000 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    const entries = journalEntryRepository.findAll()
    expect(entries).toHaveLength(1)
    expect(entries[0].sourceType).toBe('initial_balance')
    expect(entries[0].lines).toHaveLength(2)
    expect(entries[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: findInitialBalanceAccount().id, side: 'debit', amount: 30000 }),
        expect.objectContaining({ accountId: account.id, side: 'credit', amount: 30000 }),
      ]),
    )
  })

  it('資産の初期残高は「借方: 口座 / 貸方: 初期残高」で記帳される(計画Issue #143)', async () => {
    const account = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 8000 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })

    expect(journalEntryRepository.findAll()[0].lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: account.id, side: 'debit', amount: 8000 }),
        expect.objectContaining({ accountId: findInitialBalanceAccount().id, side: 'credit', amount: 8000 }),
      ]),
    )
  })

  it('初期残高ありの口座を複数登録しても、初期残高科目は1件のまま増えない(計画Issue #143)', async () => {
    for (const [category, name] of [
      ['asset', '現金'],
      ['asset', '銀行'],
      ['liability', 'カード'],
    ] as const) {
      await registerAccount(accountRepository, journalEntryRepository, {
        category,
        isReconcilable: false,
        name,
        householdMemberId: null,
        initialBalanceLines: [{ householdMemberId: null, amount: 1000 }],
        entryDate: '2026-08-03',
        journalEntryHouseholdMemberId: creatorId,
      })
    }

    expect(accountRepository.findAll().filter((a) => a.category === 'equity')).toHaveLength(1)
    expect(journalEntryRepository.findAll()).toHaveLength(3)
  })

  it('資産と負債に同名の口座を初期残高付きで登録しても、初期残高科目が原因のエラーは起きない(計画Issue #143)', async () => {
    const register = (category: 'asset' | 'liability') =>
      registerAccount(accountRepository, journalEntryRepository, {
        category,
        isReconcilable: false,
        name: '立替',
        householdMemberId: null,
        initialBalanceLines: [{ householdMemberId: null, amount: 1000 }],
        entryDate: '2026-08-03',
        journalEntryHouseholdMemberId: creatorId,
      })

    await register('asset')
    await expect(register('liability')).resolves.toMatchObject({ category: 'liability' })
  })

  it('非アクティブ化した口座と同名で初期残高付きで再登録しても、エラーにならない(計画Issue #143)', async () => {
    const first = await registerAccount(accountRepository, journalEntryRepository, {
      category: 'asset',
      isReconcilable: false,
      name: '現金',
      householdMemberId: null,
      initialBalanceLines: [{ householdMemberId: null, amount: 1000 }],
      entryDate: '2026-08-03',
      journalEntryHouseholdMemberId: creatorId,
    })
    accountRepository.deactivate(first.id)

    await expect(
      registerAccount(accountRepository, journalEntryRepository, {
        category: 'asset',
        isReconcilable: false,
        name: '現金',
        householdMemberId: null,
        initialBalanceLines: [{ householdMemberId: null, amount: 2000 }],
        entryDate: '2026-08-04',
        journalEntryHouseholdMemberId: creatorId,
      }),
    ).resolves.toMatchObject({ name: '現金' })
  })

  it('「初期残高」科目が未投入の場合、口座を作成する前にエラーとし、口座だけが残らない(計画Issue #143)', async () => {
    const unseededDb = await createTestDatabase()
    runMigrations(unseededDb)
    const unseededAccountRepository = new SqlJsAccountRepository(unseededDb)
    const unseededJournalEntryRepository = new SqlJsJournalEntryRepository(unseededDb)

    await expect(
      registerAccount(unseededAccountRepository, unseededJournalEntryRepository, {
        category: 'asset',
        isReconcilable: false,
        name: '現金',
        householdMemberId: null,
        initialBalanceLines: [{ householdMemberId: null, amount: 1000 }],
        entryDate: '2026-08-03',
        journalEntryHouseholdMemberId: creatorId,
      }),
    ).rejects.toThrow('初期残高')

    expect(unseededAccountRepository.findAll()).toHaveLength(0)
  })
})
