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
