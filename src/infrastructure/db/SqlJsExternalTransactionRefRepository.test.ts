/**
 * SqlJsExternalTransactionRefRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/reconciliation.md 2章・
 * docs/schema/reconciliation.sql に定義された突合マスタ(external_transaction_refs)の
 * 作成・参照、および同一account_id×external_idを禁止するUNIQUE制約との連携を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { SqlJsExternalTransactionRefRepository } from './SqlJsExternalTransactionRefRepository'

let db: Database
let repository: SqlJsExternalTransactionRefRepository
let bankAccountId: number
let journalEntryId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  const journalEntries = new SqlJsJournalEntryRepository(db)
  repository = new SqlJsExternalTransactionRefRepository(db)

  bankAccountId = accounts.create({
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
  }).id
  const foodExpenseAccountId = accounts.create({
    category: 'expense',
    name: '食費',
    isReconcilable: null,
  }).id

  journalEntryId = journalEntries.create({
    entryDate: '2026-08-01',
    memo: 'セブンイレブン',
    sourceType: 'external_import',
    lines: [
      { accountId: foodExpenseAccountId, side: 'debit', amount: 150 },
      { accountId: bankAccountId, side: 'credit', amount: 150 },
    ],
  }).id
})

describe('create / findById', () => {
  it('突合レコードを作成しidで参照できる', () => {
    const created = repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-001',
      entryDate: '2026-08-01',
      description: 'セブンイレブン 日本橋店',
      amount: -150,
      externalBalanceAfter: 9850,
      isSettled: null,
    })

    const found = repository.findById(created.id)

    expect(found?.accountId).toBe(bankAccountId)
    expect(found?.journalEntryId).toBe(journalEntryId)
    expect(found?.externalId).toBe('HASH-001')
    expect(found?.entryDate).toBe('2026-08-01')
    expect(found?.description).toBe('セブンイレブン 日本橋店')
    expect(found?.amount).toBe(-150)
    expect(found?.externalBalanceAfter).toBe(9850)
    expect(found?.isSettled).toBeNull()
  })

  it('externalBalanceAfter・isSettledを省略した場合はnullになる', () => {
    const created = repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-002',
      entryDate: '2026-08-01',
      description: '給与振込',
      amount: 250000,
    })

    const found = repository.findById(created.id)

    expect(found?.externalBalanceAfter).toBeNull()
    expect(found?.isSettled).toBeNull()
  })

  it('存在しないidの場合はnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('同一account_id×external_idで2件目を作成しようとするとUNIQUE制約違反で例外を投げる', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-DUP',
      entryDate: '2026-08-01',
      description: '1件目',
      amount: -100,
    })

    expect(() =>
      repository.create({
        accountId: bankAccountId,
        journalEntryId,
        externalId: 'HASH-DUP',
        entryDate: '2026-08-01',
        description: '2件目',
        amount: -100,
      }),
    ).toThrow()
  })
})

describe('findByAccountAndExternalId', () => {
  it('同一account_id×external_idの突合レコードが存在すれば返す(重複防止用、docs/domain/reconciliation.md 2.1)', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-010',
      entryDate: '2026-08-01',
      description: 'セブンイレブン',
      amount: -150,
    })

    const found = repository.findByAccountAndExternalId(bankAccountId, 'HASH-010')

    expect(found?.externalId).toBe('HASH-010')
  })

  it('external_idが一致しない場合はnullを返す', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-011',
      entryDate: '2026-08-01',
      description: 'セブンイレブン',
      amount: -150,
    })

    expect(repository.findByAccountAndExternalId(bankAccountId, 'HASH-999')).toBeNull()
  })

  it('external_idが一致してもaccount_idが異なる場合はnullを返す(重複判定は口座単位、2.1)', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-012',
      entryDate: '2026-08-01',
      description: 'セブンイレブン',
      amount: -150,
    })
    const otherAccountId = new SqlJsAccountRepository(db).create({
      category: 'asset',
      name: '証券口座',
      isReconcilable: true,
    }).id

    expect(repository.findByAccountAndExternalId(otherAccountId, 'HASH-012')).toBeNull()
  })
})

describe('findByAccount', () => {
  it('対象口座の突合レコードを全件返す', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-020',
      entryDate: '2026-08-01',
      description: '1件目',
      amount: -100,
    })
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-021',
      entryDate: '2026-08-02',
      description: '2件目',
      amount: -200,
    })

    const found = repository.findByAccount(bankAccountId)

    expect(found.map((ref) => ref.externalId).sort()).toEqual(['HASH-020', 'HASH-021'])
  })

  it('他口座のレコードは含めない', () => {
    repository.create({
      accountId: bankAccountId,
      journalEntryId,
      externalId: 'HASH-030',
      entryDate: '2026-08-01',
      description: '対象口座',
      amount: -100,
    })
    const otherAccountId = new SqlJsAccountRepository(db).create({
      category: 'asset',
      name: '証券口座',
      isReconcilable: true,
    }).id

    expect(repository.findByAccount(otherAccountId)).toEqual([])
  })

  it('該当レコードが存在しない口座では空配列を返す', () => {
    expect(repository.findByAccount(bankAccountId)).toEqual([])
  })
})
