/**
 * SqlJsAccountRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/accounts.md・
 * docs/schema/accounts.sql に定義された勘定科目のライフサイクル(作成・参照・更新・
 * 削除・非アクティブ化)と、DDL側のCHECK制約・トリガーが期待通り機能することを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

let db: Database
let repository: SqlJsAccountRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
})

describe('create / findById', () => {
  it('資産科目を作成しidで参照できる', () => {
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

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全ての科目を返す', () => {
    repository.create({ category: 'asset', name: '現金', isReconcilable: false })
    repository.create({ category: 'expense', name: '食費', isReconcilable: null })

    const all = repository.findAll()

    expect(all.map((a) => a.name)).toEqual(expect.arrayContaining(['現金', '食費']))
  })
})

describe('update', () => {
  it('区分を変えずに科目名を変更する', () => {
    const created = repository.create({
      category: 'expense',
      name: '娯楽費',
      isReconcilable: null,
    })

    const updated = repository.update(created.id, { name: '趣味・娯楽費' })

    expect(updated.name).toBe('趣味・娯楽費')
    expect(updated.category).toBe('expense')
  })

  it('生SQLであっても区分の直接変更は許可されない(prevent_category_changeトリガー)', () => {
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
  it('紐づく参照が0件の科目は物理削除できる', () => {
    const created = repository.create({
      category: 'expense',
      name: '雑費',
      isReconcilable: null,
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('journal_linesから参照されている科目の削除は拒否される', () => {
    const account = repository.create({
      category: 'expense',
      name: '交通費',
      isReconcilable: null,
    })
    db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
    const memberId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`,
      [memberId],
    )
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, side, amount)
       VALUES (?, ?, 'debit', 500)`,
      [entryId, account.id],
    )

    expect(() => repository.delete(account.id)).toThrow()
  })

  it('budgetsから参照されている科目の削除は拒否される', () => {
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

  it('recurring_transaction_rulesから参照されている科目の削除は拒否される', () => {
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

  it('参照が0件でもシステム管理科目の削除は拒否される', () => {
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
  it('科目を削除せず非アクティブにする', () => {
    const created = repository.create({
      category: 'asset',
      name: '解約した口座',
      isReconcilable: true,
    })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('システム管理科目の非アクティブ化は拒否される', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(普通預金)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(() => repository.deactivate(systemManaged.id)).toThrow()
  })
})

describe('activate', () => {
  it('非アクティブな科目を再度アクティブにする', () => {
    const created = repository.create({
      category: 'asset',
      name: '解約した口座',
      isReconcilable: true,
    })
    repository.deactivate(created.id)

    const activated = repository.activate(created.id)

    expect(activated.isActive).toBe(true)
  })

  it('is_activeの値によらず科目をアクティブにできる', () => {
    const created = repository.create({
      category: 'asset',
      name: 'もともとアクティブな口座',
      isReconcilable: true,
    })

    const activated = repository.activate(created.id)

    expect(activated.isActive).toBe(true)
  })
})

describe('system-managed科目は name 以外の変更を禁止(domain/accounts.md 3.1)', () => {
  it('システム管理科目でも名前の変更は引き続き許可される', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高(旧名義)',
      isReconcilable: null,
      isSystemManaged: true,
    })

    const updated = repository.update(systemManaged.id, { name: '初期残高(新名義)' })

    expect(updated.name).toBe('初期残高(新名義)')
  })

  it('システム管理科目のhouseholdMemberId変更は拒否される', () => {
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
  it('ユーザーが作成したequity科目(is_system_managed = false)は拒否される', () => {
    expect(() =>
      repository.create({
        category: 'equity',
        name: 'ユーザーが作った純資産科目',
        isReconcilable: null,
        isSystemManaged: false,
      }),
    ).toThrow()
  })

  it('システム管理のequity科目は作成できる', () => {
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
  it('is_reconcilable = nullの資産科目は拒否される', () => {
    expect(() =>
      repository.create({ category: 'asset', name: '不正な資産科目', isReconcilable: null }),
    ).toThrow()
  })

  it('is_reconcilableがnull以外の費用科目は拒否される', () => {
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
  it('同一区分内でアクティブな重複名の作成は拒否される', () => {
    repository.create({ category: 'expense', name: '重複科目', isReconcilable: null })

    expect(() =>
      repository.create({ category: 'expense', name: '重複科目', isReconcilable: null }),
    ).toThrow()
  })

  it('元の科目を非アクティブ化した後は同名で再作成できる', () => {
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

describe('accountGroupIdのcategory一致検証(計画Issue #129)', () => {
  it('科目のcategoryとグループのcategoryが一致していれば割り当てできる', () => {
    const groupId = insertAccountGroup(db, { name: '現金同等物', category: 'asset' })

    const created = repository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
      accountGroupId: groupId,
    })

    expect(created.accountGroupId).toBe(groupId)
  })

  it('科目のcategoryとグループのcategoryが異なる場合、新規作成時に拒否される', () => {
    const groupId = insertAccountGroup(db, { name: 'クレカ', category: 'liability' })

    expect(() =>
      repository.create({
        category: 'asset',
        name: '普通預金',
        isReconcilable: true,
        accountGroupId: groupId,
      }),
    ).toThrow()
  })

  it('科目のcategoryとグループのcategoryが異なる場合、updateでの割り当ても拒否される', () => {
    const groupId = insertAccountGroup(db, { name: 'クレカ', category: 'liability' })
    const account = repository.create({ category: 'asset', name: '普通預金', isReconcilable: true })

    expect(() => repository.update(account.id, { accountGroupId: groupId })).toThrow()
  })

  it('未分類(accountGroupId = null)への変更はcategoryを問わず許可される', () => {
    const groupId = insertAccountGroup(db, { name: '現金同等物', category: 'asset' })
    const account = repository.create({
      category: 'asset',
      name: '普通預金',
      isReconcilable: true,
      accountGroupId: groupId,
    })

    const updated = repository.update(account.id, { accountGroupId: null })

    expect(updated.accountGroupId).toBeNull()
  })
})

describe('sortOrder(計画Issue #129)', () => {
  it('作成時に指定しなければ既定値0になる', () => {
    const created = repository.create({ category: 'expense', name: '雑費', isReconcilable: null })

    expect(created.sortOrder).toBe(0)
  })

  it('sortOrderを明示的に指定して作成できる', () => {
    const created = repository.create({
      category: 'expense',
      name: '雑費',
      isReconcilable: null,
      sortOrder: 3,
    })

    expect(created.sortOrder).toBe(3)
  })

  it('updateでsortOrderを変更できる', () => {
    const created = repository.create({ category: 'expense', name: '雑費', isReconcilable: null })

    const updated = repository.update(created.id, { sortOrder: 5 })

    expect(updated.sortOrder).toBe(5)
  })
})

function insertAccountGroup(
  database: Database,
  { name, category }: { name: string; category: string },
): number {
  database.run('INSERT INTO account_groups (name, category) VALUES (?, ?)', [name, category])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}
