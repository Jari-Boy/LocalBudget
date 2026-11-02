/**
 * SqlJsSettlementBatchRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/settlement.md・
 * docs/schema/settlement_batches.sql に定義された精算バッチの作成・参照・削除と、
 * DDL側のCHECK制約・トリガーが期待通り機能することを検証する(計画Issue #133)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsSettlementBatchRepository } from './SqlJsSettlementBatchRepository'

let db: Database
let repository: SqlJsSettlementBatchRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsSettlementBatchRepository(db)
})

describe('create / findById', () => {
  it('counterparty_id省略(世帯メンバー間の割勘)で精算バッチを作成する', () => {
    const created = repository.create({ name: '6月生活費', type: 'expense_splitting' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '6月生活費',
      type: 'expense_splitting',
      counterpartyId: null,
    })
  })

  it('counterparty_idを指定(世帯外の相手との割勘)して精算バッチを作成する', () => {
    const counterpartyId = insertCounterparty(db, '田中さん')

    const created = repository.create({ name: '田中さんとの飲み代', type: 'expense_splitting', counterpartyId })

    expect(created.counterpartyId).toBe(counterpartyId)
  })

  it('type=installmentで精算バッチを作成する', () => {
    const created = repository.create({ name: 'スマホ24回払い', type: 'installment' })

    expect(created.type).toBe('installment')
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('update', () => {
  it('counterparty_idを後から設定できる(割勘起票フォームで参加者確定後に設定するため)', () => {
    const created = repository.create({ name: '田中さんとの飲み代', type: 'expense_splitting' })
    const counterpartyId = insertCounterparty(db, '田中さん')

    const updated = repository.update(created.id, { counterpartyId })

    expect(updated.counterpartyId).toBe(counterpartyId)
  })
})

describe('findAll', () => {
  it('作成した全ての精算バッチを返す', () => {
    repository.create({ name: '6月生活費', type: 'expense_splitting' })
    repository.create({ name: 'スマホ24回払い', type: 'installment' })

    const all = repository.findAll()

    expect(all.map((b) => b.name)).toEqual(expect.arrayContaining(['6月生活費', 'スマホ24回払い']))
  })
})

describe('delete', () => {
  it('紐づく仕訳明細が0件の精算バッチは物理削除できる', () => {
    const created = repository.create({ name: '紐づく仕訳がないバッチ', type: 'expense_splitting' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('journal_linesから参照されている精算バッチの削除は拒否される', () => {
    const batch = repository.create({ name: '紐づく仕訳があるバッチ', type: 'expense_splitting' })
    const accountId = insertAccount(db, 'asset', '立替金')
    db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
    const memberId = lastInsertRowId(db)
    db.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [memberId])
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, settlement_batch_id, side, amount)
       VALUES (?, ?, ?, 'debit', 500)`,
      [entryId, accountId, batch.id],
    )

    expect(() => repository.delete(batch.id)).toThrow()
  })
})

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertAccount(database: Database, category: string, name: string): number {
  database.run(`INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, 0)`, [category, name])
  return lastInsertRowId(database)
}

function insertCounterparty(database: Database, name: string): number {
  database.run(`INSERT INTO counterparties (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}
