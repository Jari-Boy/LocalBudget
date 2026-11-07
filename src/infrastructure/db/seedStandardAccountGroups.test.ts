/**
 * seedStandardAccountGroups の統合テスト(計画Issue #154)。
 * 口座・カードの登録時に初期選択する標準グループ(資産: 普通預金・現金・電子マネー、
 * 負債: クレジットカード)を、通常のグループとしてWorker起動時に投入することを検証する。
 * グループが1件も無く、利用者が登録した資産・負債の科目も無い新規DBにだけ投入し、
 * 既存の構成(グループの削除・改名を含む)は変えないこと、再実行しても重複しないことを確認する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { seedAdvanceAccounts } from './seedAdvanceAccounts'
import { seedStandardAccountGroups, STANDARD_ACCOUNT_GROUPS } from './seedStandardAccountGroups'

let db: Database
let groups: SqlJsAccountGroupRepository
let accounts: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  groups = new SqlJsAccountGroupRepository(db)
  accounts = new SqlJsAccountRepository(db)
})

describe('seedStandardAccountGroups', () => {
  it('標準グループは、資産の普通預金と現金・電子マネー、負債のクレジットカードである', () => {
    expect(STANDARD_ACCOUNT_GROUPS).toEqual([
      { key: 'bank', category: 'asset', name: '普通預金' },
      { key: 'cash', category: 'asset', name: '現金・電子マネー' },
      { key: 'creditCard', category: 'liability', name: 'クレジットカード' },
    ])
  })

  it('新規DBには、標準グループを通常のグループとして3件投入する', () => {
    seedStandardAccountGroups(db)

    expect(groups.findAll().map((g) => [g.category, g.name, g.parentGroupId, g.isActive])).toEqual([
      ['asset', '普通預金', null, true],
      ['asset', '現金・電子マネー', null, true],
      ['liability', 'クレジットカード', null, true],
    ])
  })

  it('システム管理の科目(立替金・未払金)しか無いDBは新規とみなして投入する', () => {
    seedAdvanceAccounts(db)

    seedStandardAccountGroups(db)

    expect(groups.findAll()).toHaveLength(3)
  })

  it('再実行しても重複して投入しない', () => {
    seedStandardAccountGroups(db)
    seedStandardAccountGroups(db)

    expect(groups.findAll()).toHaveLength(3)
  })

  it('グループが既にあるDBには投入しない(利用者が削除・改名した構成を復活させない)', () => {
    groups.create({ name: '自分のグループ', category: 'asset' })

    seedStandardAccountGroups(db)

    expect(groups.findAll().map((g) => g.name)).toEqual(['自分のグループ'])
  })

  it('利用者が登録した資産・負債の科目があるDBには投入しない', () => {
    accounts.create({ category: 'asset', name: '楽天銀行', isReconcilable: true })

    seedStandardAccountGroups(db)

    expect(groups.findAll()).toHaveLength(0)
  })

  it('収益・費用の科目しか無いDBには投入する', () => {
    accounts.create({ category: 'expense', name: '食費', isReconcilable: null })

    seedStandardAccountGroups(db)

    expect(groups.findAll()).toHaveLength(3)
  })
})
