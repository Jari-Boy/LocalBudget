/**
 * seedDefaultAccounts の統合テスト(計画Issue #96)。
 * 収益(revenue)・費用(expense)区分の科目が0件の状態でWorker起動時に呼ばれた場合に
 * 標準科目一式を自動投入すること、区分ごとに独立して冪等に判定されること、
 * seedDefaultHouseholdMember・seedBuiltInMappingDefinitionsと同じ設計方針で検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { seedDefaultAccounts } from './seedDefaultAccounts'
import { DEFAULT_EXPENSE_ACCOUNT_NAMES, DEFAULT_REVENUE_ACCOUNT_NAMES } from './defaultAccountSeedData'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

describe('seedDefaultAccounts', () => {
  it('revenue区分の科目が0件の場合、標準収益科目(3件)をすべて投入する', () => {
    seedDefaultAccounts(db)

    const revenueAccounts = repository.findAll().filter((account) => account.category === 'revenue')
    expect(revenueAccounts.map((account) => account.name).sort()).toEqual(
      [...DEFAULT_REVENUE_ACCOUNT_NAMES].sort(),
    )
  })

  it('expense区分の科目が0件の場合、標準費用科目(12件)をすべて投入する', () => {
    seedDefaultAccounts(db)

    const expenseAccounts = repository.findAll().filter((account) => account.category === 'expense')
    expect(expenseAccounts.map((account) => account.name).sort()).toEqual(
      [...DEFAULT_EXPENSE_ACCOUNT_NAMES].sort(),
    )
  })

  it('投入される科目はisSystemManaged = false, accountGroupId = null, householdMemberId = null, isReconcilable = nullで作成される', () => {
    seedDefaultAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.length).toBeGreaterThan(0)
    for (const account of accounts) {
      expect(account.isSystemManaged).toBe(false)
      expect(account.accountGroupId).toBeNull()
      expect(account.householdMemberId).toBeNull()
      expect(account.isReconcilable).toBeNull()
    }
  })

  it('revenue区分に既に科目が1件でも存在する場合、その区分の投入はスキップされる(区分ごとの独立判定)', () => {
    repository.create({ category: 'revenue', name: 'ユーザー作成の収益科目', isReconcilable: null })

    seedDefaultAccounts(db)

    const revenueAccounts = repository.findAll().filter((account) => account.category === 'revenue')
    expect(revenueAccounts.map((account) => account.name)).toEqual(['ユーザー作成の収益科目'])
  })

  it('expense区分だけ既存の場合、revenue区分のみ独立して投入される', () => {
    repository.create({ category: 'expense', name: 'ユーザー作成の費用科目', isReconcilable: null })

    seedDefaultAccounts(db)

    const expenseAccounts = repository.findAll().filter((account) => account.category === 'expense')
    const revenueAccounts = repository.findAll().filter((account) => account.category === 'revenue')
    expect(expenseAccounts.map((account) => account.name)).toEqual(['ユーザー作成の費用科目'])
    expect(revenueAccounts).toHaveLength(DEFAULT_REVENUE_ACCOUNT_NAMES.length)
  })

  it('revenue区分だけ既存の場合、expense区分のみ独立して投入される(逆方向の独立判定)', () => {
    repository.create({ category: 'revenue', name: 'ユーザー作成の収益科目', isReconcilable: null })

    seedDefaultAccounts(db)

    const expenseAccounts = repository.findAll().filter((account) => account.category === 'expense')
    const revenueAccounts = repository.findAll().filter((account) => account.category === 'revenue')
    expect(revenueAccounts.map((account) => account.name)).toEqual(['ユーザー作成の収益科目'])
    expect(expenseAccounts).toHaveLength(DEFAULT_EXPENSE_ACCOUNT_NAMES.length)
  })

  it('2回連続で呼び出しても重複して投入されない(Worker起動のたびに呼ばれても冪等)', () => {
    seedDefaultAccounts(db)
    seedDefaultAccounts(db)

    const accounts = repository.findAll()
    expect(accounts).toHaveLength(DEFAULT_REVENUE_ACCOUNT_NAMES.length + DEFAULT_EXPENSE_ACCOUNT_NAMES.length)
  })

  it('投入後にユーザーがrevenue区分の科目を全て削除して0件に戻した場合、次回呼び出しで再度投入される', () => {
    seedDefaultAccounts(db)
    for (const account of repository.findAll().filter((a) => a.category === 'revenue')) {
      repository.delete(account.id)
    }

    seedDefaultAccounts(db)

    const revenueAccounts = repository.findAll().filter((account) => account.category === 'revenue')
    expect(revenueAccounts).toHaveLength(DEFAULT_REVENUE_ACCOUNT_NAMES.length)
  })

  it('asset/liability/equity区分の科目、および「費用・残高調整」科目は一切投入されない', () => {
    seedDefaultAccounts(db)

    const accounts = repository.findAll()
    expect(accounts.every((account) => account.category === 'revenue' || account.category === 'expense')).toBe(
      true,
    )
    expect(accounts.some((account) => account.name === '残高調整')).toBe(false)
  })
})
