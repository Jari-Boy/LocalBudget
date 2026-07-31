/**
 * SqlJsBudgetRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/budgets.md・
 * docs/schema/budgets.sql に定義された予算の作成・参照・更新・削除と、
 * DDL側のトリガー(expense区分以外の拒否)・UNIQUE制約(科目/年月の重複拒否)が
 * 期待通り機能することを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsBudgetRepository } from './SqlJsBudgetRepository'

let db: Database
let repository: SqlJsBudgetRepository
let expenseAccountId: number
let revenueAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsBudgetRepository(db)
  expenseAccountId = insertAccount(db, 'expense', '食費')
  revenueAccountId = insertAccount(db, 'revenue', '給与')
})

describe('create / findById', () => {
  it('expense区分の科目に対して予算を作成する', () => {
    const created = repository.create({
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('expense区分以外の科目を指定した作成はDDLトリガーにより拒否される', () => {
    expect(() =>
      repository.create({ accountId: revenueAccountId, yearMonth: '2026-08', amount: 30000 }),
    ).toThrow()
  })

  it('同一科目・同一年月の重複作成はUNIQUE制約により拒否される', () => {
    repository.create({ accountId: expenseAccountId, yearMonth: '2026-08', amount: 30000 })

    expect(() =>
      repository.create({ accountId: expenseAccountId, yearMonth: '2026-08', amount: 20000 }),
    ).toThrow()
  })
})

describe('findByAccountAndYearMonth', () => {
  it('科目・年月に一致する予算を返す', () => {
    const created = repository.create({
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })

    const found = repository.findByAccountAndYearMonth(expenseAccountId, '2026-08')

    expect(found).toMatchObject({ id: created.id, amount: 30000 })
  })

  it('一致する予算がない場合はnullを返す', () => {
    expect(repository.findByAccountAndYearMonth(expenseAccountId, '2026-08')).toBeNull()
  })
})

describe('findByYearMonth', () => {
  it('指定した年月の予算を全て返す', () => {
    const otherExpenseAccountId = insertAccount(db, 'expense', '交通費')
    repository.create({ accountId: expenseAccountId, yearMonth: '2026-08', amount: 30000 })
    repository.create({ accountId: otherExpenseAccountId, yearMonth: '2026-08', amount: 10000 })
    repository.create({ accountId: expenseAccountId, yearMonth: '2026-09', amount: 30000 })

    const found = repository.findByYearMonth('2026-08')

    expect(found.map((b) => b.accountId)).toEqual(
      expect.arrayContaining([expenseAccountId, otherExpenseAccountId]),
    )
    expect(found).toHaveLength(2)
  })

  it('該当する予算がない場合は空配列を返す', () => {
    expect(repository.findByYearMonth('2026-08')).toEqual([])
  })
})

describe('update', () => {
  it('金額を変更する', () => {
    const created = repository.create({
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })

    const updated = repository.update(created.id, { amount: 40000 })

    expect(updated.amount).toBe(40000)
  })

  it('updated_atが更新される', () => {
    const created = repository.create({
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE budgets SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [created.id])

    const updated = repository.update(created.id, { amount: 40000 })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('予算を物理削除する', () => {
    const created = repository.create({
      accountId: expenseAccountId,
      yearMonth: '2026-08',
      amount: 30000,
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })
})

function insertAccount(database: Database, category: string, name: string): number {
  database.run(`INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, NULL)`, [
    category,
    name,
  ])
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
