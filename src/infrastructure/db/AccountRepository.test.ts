/**
 * AccountRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/accounts.md・
 * docs/schema/accounts.sql に定義された勘定科目のライフサイクル(作成・参照・更新・
 * 削除・非アクティブ化)と、DDL側のCHECK制約・トリガーが期待通り機能することを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { AccountRepository } from './AccountRepository'

let db: Database
let repository: AccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new AccountRepository(db)
})

describe('create / findById', () => {
  it('creates an asset account and reads it back by id', () => {
    const created = repository.create({
      category: 'asset',
      name: '三菱UFJ銀行',
      isReconcilable: true,
    })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      category: 'asset',
      name: '三菱UFJ銀行',
      isReconcilable: true,
      isActive: true,
      isSystemManaged: false,
    })
  })

  it('returns null for an id that does not exist', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('returns every created account', () => {
    repository.create({ category: 'asset', name: '現金', isReconcilable: false })
    repository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const all = repository.findAll()

    expect(all.map((a) => a.name)).toEqual(expect.arrayContaining(['現金', '食費']))
  })
})

describe('update', () => {
  it('changes the label within the same category', () => {
    const created = repository.create({
      category: 'expense',
      name: '娯楽費',
      isReconcilable: null,
    })

    const updated = repository.update(created.id, { name: '趣味・娯楽費' })

    expect(updated.name).toBe('趣味・娯楽費')
    expect(updated.category).toBe('expense')
  })

  it('does not allow changing category directly via raw SQL (prevent_category_change trigger)', () => {
    const created = repository.create({
      category: 'expense',
      name: '水道光熱費',
      isReconcilable: null,
    })

    expect(() =>
      db.run('UPDATE accounts SET category = ? WHERE id = ?', ['asset', created.id]),
    ).toThrow()
  })
})

describe('delete', () => {
  it('physically deletes an account with zero references', () => {
    const created = repository.create({
      category: 'expense',
      name: '雑費',
      isReconcilable: null,
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('refuses to delete an account referenced by journal_lines', () => {
    const account = repository.create({
      category: 'expense',
      name: '交通費',
      isReconcilable: null,
    })
    db.run(
      `INSERT INTO journal_entries (entry_date) VALUES ('2026-07-01')`,
    )
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, side, amount)
       VALUES (?, ?, 'debit', 500)`,
      [entryId, account.id],
    )

    expect(() => repository.delete(account.id)).toThrow()
  })

  it('refuses to delete an account referenced by budgets', () => {
    const account = repository.create({
      category: 'expense',
      name: '食費(予算あり)',
      isReconcilable: null,
    })
    db.run(
      `INSERT INTO budgets (account_id, year_month, amount) VALUES (?, '2026-07', 30000)`,
      [account.id],
    )

    expect(() => repository.delete(account.id)).toThrow()
  })

  it('refuses to delete an account referenced by recurring_transaction_rules', () => {
    const debitAccount = repository.create({
      category: 'expense',
      name: '家賃',
      isReconcilable: null,
    })
    const creditAccount = repository.create({
      category: 'liability',
      name: '楽天カード',
      isReconcilable: false,
    })
    db.run(
      `INSERT INTO recurring_transaction_rules
        (name, debit_account_id, credit_account_id, amount, frequency, day_of_month)
       VALUES (?, ?, ?, 80000, 'monthly', 27)`,
      ['家賃引き落とし', debitAccount.id, creditAccount.id],
    )

    expect(() => repository.delete(debitAccount.id)).toThrow()
  })

  it('refuses to delete a system-managed account even with zero references', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(現金)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(() => repository.delete(systemManaged.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('marks the account inactive without deleting it', () => {
    const created = repository.create({
      category: 'asset',
      name: '解約した口座',
      isReconcilable: true,
    })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('refuses to deactivate a system-managed account', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(() => repository.deactivate(systemManaged.id)).toThrow()
  })
})

describe('system-managed科目は name 以外の変更を禁止(domain/accounts.md 3.1)', () => {
  it('still allows changing the name of a system-managed account', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(旧名義)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    const updated = repository.update(systemManaged.id, { name: '初期残高(新名義)' })

    expect(updated.name).toBe('初期残高(新名義)')
  })

  it('refuses to change householdMemberId on a system-managed account', () => {
    const member = insertHouseholdMember(db, '夫')
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(証券口座)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(() =>
      repository.update(systemManaged.id, { householdMemberId: member }),
    ).toThrow()
  })
})

describe('equity区分のライフサイクルルール(prevent_user_created_equity_account)', () => {
  it('rejects a user-created equity account (is_system_managed = false)', () => {
    expect(() =>
      repository.create({
        category: 'equity',
        name: 'ユーザーが作った純資産科目',
        isReconcilable: null,
        isSystemManaged: false,
      }),
    ).toThrow()
  })

  it('allows a system-managed equity account', () => {
    const created = repository.create({
      category: 'equity',
      name: '初期残高(三菱UFJ銀行)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(created.isSystemManaged).toBe(true)
  })
})

describe('is_reconcilable のCHECK制約(区分依存)', () => {
  it('rejects asset accounts with is_reconcilable = null', () => {
    expect(() =>
      repository.create({ category: 'asset', name: '不正な資産科目', isReconcilable: null }),
    ).toThrow()
  })

  it('rejects expense accounts with a non-null is_reconcilable', () => {
    expect(() =>
      repository.create({
        category: 'expense',
        name: '不正な費用科目',
        isReconcilable: true,
      }),
    ).toThrow()
  })
})

describe('勘定科目名のユニーク制約(区分内・is_active=TRUEのみ)', () => {
  it('rejects creating an active duplicate name within the same category', () => {
    repository.create({ category: 'expense', name: '重複科目', isReconcilable: null })

    expect(() =>
      repository.create({ category: 'expense', name: '重複科目', isReconcilable: null }),
    ).toThrow()
  })

  it('allows the same name again after the original is deactivated', () => {
    const original = repository.create({
      category: 'expense',
      name: '再利用する科目名',
      isReconcilable: null,
    })
    repository.deactivate(original.id)

    expect(() =>
      repository.create({
        category: 'expense',
        name: '再利用する科目名',
        isReconcilable: null,
      }),
    ).not.toThrow()
  })
})

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}
