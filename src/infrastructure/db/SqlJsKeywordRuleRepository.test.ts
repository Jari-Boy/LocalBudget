/**
 * SqlJsKeywordRuleRepository(キーワードルール keyword_rules の永続化)の統合テスト。
 * 「摘要のキーワード → 取引先(任意)+相手科目(任意)」というルールの CRUD、摘要への部分一致検索、
 * DDL の制約(取引先か科目の少なくとも一方が必須、取引先と科目の併記は収益・費用の科目だけ)を検証する
 * (計画Issue #219、docs/decisions.md 2026-11-16)。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'
import { SqlJsKeywordRuleRepository } from './SqlJsKeywordRuleRepository'

let db: Database
let rules: SqlJsKeywordRuleRepository
let counterparties: SqlJsCounterpartyRepository
let accounts: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  rules = new SqlJsKeywordRuleRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
  accounts = new SqlJsAccountRepository(db)
})

const account = (name: string, category: 'asset' | 'liability' | 'revenue' | 'expense') =>
  accounts.create({ name, category, isReconcilable: category === 'asset' || category === 'liability' ? false : null })

describe('create / findById', () => {
  it('科目だけのルール(資産科目)を作成して取得できる', () => {
    const cash = account('現金', 'asset')

    const rule = rules.create({ pattern: 'ATM', accountId: cash.id })

    expect(rule).toMatchObject({ pattern: 'ATM', counterpartyId: null, accountId: cash.id })
    expect(rules.findById(rule.id)).toEqual(rule)
  })

  it('取引先だけのルールを作成できる', () => {
    const aeon = counterparties.create({ name: 'イオン' })

    const rule = rules.create({ pattern: 'AEON', counterpartyId: aeon.id })

    expect(rule).toMatchObject({ counterpartyId: aeon.id, accountId: null })
  })

  it('取引先と収益・費用の科目の両方を持つルールを作成できる', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const food = account('食費', 'expense')

    const rule = rules.create({ pattern: 'AEON', counterpartyId: aeon.id, accountId: food.id })

    expect(rule).toMatchObject({ counterpartyId: aeon.id, accountId: food.id })
  })

  it('取引先も科目も指定しないルールは作成できない', () => {
    expect(() => rules.create({ pattern: 'X' })).toThrow()
  })

  it('取引先と資産・負債の科目の両方を持つルールは作成できない', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const cash = account('現金', 'asset')

    expect(() => rules.create({ pattern: 'AEON', counterpartyId: aeon.id, accountId: cash.id })).toThrow()
  })
})

describe('update', () => {
  it('キーワード・取引先・科目を更新できる', () => {
    const cash = account('現金', 'asset')
    const card = account('未払金', 'liability')
    const rule = rules.create({ pattern: 'ATM', accountId: cash.id })

    const updated = rules.update(rule.id, { pattern: 'セブン銀行', accountId: card.id })

    expect(updated).toMatchObject({ pattern: 'セブン銀行', accountId: card.id })
  })

  it('取引先と科目の両方を持つルールで、科目を資産に変えると拒否される', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const food = account('食費', 'expense')
    const cash = account('現金', 'asset')
    const rule = rules.create({ pattern: 'AEON', counterpartyId: aeon.id, accountId: food.id })

    expect(() => rules.update(rule.id, { accountId: cash.id })).toThrow()
  })
})

describe('delete', () => {
  it('ルールを物理削除する', () => {
    const cash = account('現金', 'asset')
    const rule = rules.create({ pattern: 'ATM', accountId: cash.id })

    rules.delete(rule.id)

    expect(rules.findById(rule.id)).toBeNull()
  })

  it('取引先を削除すると、その取引先のルールも一緒に消える', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const rule = rules.create({ pattern: 'AEON', counterpartyId: aeon.id })

    counterparties.delete(aeon.id)

    expect(rules.findById(rule.id)).toBeNull()
  })
})

describe('科目の削除(計画Issue #219 決定16)', () => {
  it('科目だけのルールは、その科目と一緒に消える', () => {
    const cash = account('現金', 'asset')
    const rule = rules.create({ pattern: 'ATM', accountId: cash.id })

    accounts.delete(cash.id)

    expect(rules.findById(rule.id)).toBeNull()
  })

  it('取引先付きのルールは消えず、科目だけが外れて取引先のキーワードとして残る(取引先の推定を失わない)', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const food = account('食費', 'expense')
    const rule = rules.create({ pattern: 'AEON', counterpartyId: aeon.id, accountId: food.id })

    accounts.delete(food.id)

    expect(rules.findById(rule.id)).toMatchObject({ pattern: 'AEON', counterpartyId: aeon.id, accountId: null })
  })

  it('ほかの科目のルールは変わらない', () => {
    const cash = account('現金', 'asset')
    const card = account('未払金', 'liability')
    const kept = rules.create({ pattern: 'VISA', accountId: card.id })

    accounts.delete(cash.id)

    expect(rules.findById(kept.id)).toMatchObject({ accountId: card.id })
  })
})

describe('findAll / findByCounterparty / findByAccount', () => {
  it('全件・取引先別・科目別に列挙できる', () => {
    const aeon = counterparties.create({ name: 'イオン' })
    const cash = account('現金', 'asset')
    const a = rules.create({ pattern: 'AEON', counterpartyId: aeon.id })
    const b = rules.create({ pattern: 'ATM', accountId: cash.id })

    expect(rules.findAll().map((r) => r.id)).toEqual([a.id, b.id])
    expect(rules.findByCounterparty(aeon.id).map((r) => r.id)).toEqual([a.id])
    expect(rules.findByAccount(cash.id).map((r) => r.id)).toEqual([b.id])
  })
})

describe('findMatching', () => {
  it('正規化済みの摘要に部分一致するルールを返す', () => {
    const cash = account('現金', 'asset')
    rules.create({ pattern: 'ATM', accountId: cash.id })
    rules.create({ pattern: 'AMAZON', counterpartyId: counterparties.create({ name: 'Amazon' }).id })

    const matches = rules.findMatching('ATM引出セブン')

    expect(matches.map((r) => r.pattern)).toEqual(['ATM'])
  })

  it('一致しなければ空配列を返す', () => {
    expect(rules.findMatching('なにもない')).toEqual([])
  })
})
