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
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsRecurringTransactionRuleRepository } from './SqlJsRecurringTransactionRuleRepository'
import { twoLineRuleLines } from '../../domain/recurring-transaction/twoLineRuleLines'

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

describe('update: 既定の世帯メンバーの変更と過去の明細行(計画Issue #169)', () => {
  /** 現金(既定メンバーなし)に、夫の行と妻の行を1行ずつ持つ仕訳と、別の科目だけの行を作る */
  function setUp() {
    db.run(`INSERT INTO household_members (name) VALUES ('夫')`)
    const husbandId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    db.run(`INSERT INTO household_members (name) VALUES ('妻')`)
    const wifeId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    const cash = repository.create({ category: 'asset', name: '現金', isReconcilable: false })
    const food = repository.create({ category: 'expense', name: '食費', isReconcilable: null })
    db.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [husbandId])
    const entryId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    const insert = (accountId: number, memberId: number, side: string) =>
      db.run(
        `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount) VALUES (?, ?, ?, ?, 500)`,
        [entryId, accountId, memberId, side],
      )
    insert(cash.id, husbandId, 'debit')
    insert(cash.id, wifeId, 'debit')
    insert(food.id, wifeId, 'credit')
    const membersOf = (accountId: number) =>
      (db.exec(`SELECT household_member_id FROM journal_lines WHERE account_id = ${accountId} ORDER BY id`)[0]?.values ?? []).map(
        (row) => row[0] as number,
      )
    return { husbandId, wifeId, cash, food, membersOf }
  }

  it('updateExistingLinesを指定すると、その科目の過去の明細行がすべて新しい既定メンバーになる(ほかの科目の行は変わらない)', () => {
    const { husbandId, wifeId, cash, food, membersOf } = setUp()

    const updated = repository.update(cash.id, { householdMemberId: husbandId }, { updateExistingLines: true })

    expect(updated.householdMemberId).toBe(husbandId)
    expect(membersOf(cash.id)).toEqual([husbandId, husbandId])
    expect(membersOf(food.id)).toEqual([wifeId])
  })

  it('updateExistingLinesを指定しなければ、過去の明細行は旧メンバーのまま残る', () => {
    const { husbandId, wifeId, cash, membersOf } = setUp()

    const updated = repository.update(cash.id, { householdMemberId: husbandId })

    expect(updated.householdMemberId).toBe(husbandId)
    expect(membersOf(cash.id)).toEqual([husbandId, wifeId])
  })

  it('既定メンバーを解除する(null)場合は、updateExistingLinesを指定しても明細行は変わらない', () => {
    const { husbandId, wifeId, cash, membersOf } = setUp()
    repository.update(cash.id, { householdMemberId: husbandId }, { updateExistingLines: true })

    repository.update(cash.id, { householdMemberId: null }, { updateExistingLines: true })

    expect(repository.findById(cash.id)?.householdMemberId).toBeNull()
    expect(membersOf(cash.id)).toEqual([husbandId, husbandId])
    expect(wifeId).not.toBe(husbandId)
  })

  it('旧メンバーのまま残した行は、金額などを編集しても保存できる(UPDATEトリガ)', () => {
    const { husbandId, cash } = setUp()
    repository.update(cash.id, { householdMemberId: husbandId })

    expect(() => db.run(`UPDATE journal_lines SET amount = 900 WHERE account_id = ?`, [cash.id])).not.toThrow()
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
      `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
       VALUES (?, ?, ?, 'debit', 500)`,
      [entryId, account.id, memberId],
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
    new SqlJsRecurringTransactionRuleRepository(db).create({
      name: '家賃引き落とし',
      lines: twoLineRuleLines(debitAccount.id, creditAccount.id, 80000),
      frequency: 'monthly',
      dayOfMonth: 27,
    })

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

describe('システム管理科目のグループ・並び順の変更(計画Issue #143)', () => {
  it('システム管理科目のグループ(equityのグループ含む)と並び順を変更できる', () => {
    const groupRepository = new SqlJsAccountGroupRepository(db)
    const group = groupRepository.create({ name: '元手', category: 'equity' })
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })

    const updated = repository.update(systemManaged.id, { accountGroupId: group.id, sortOrder: 3 })

    expect(updated).toMatchObject({ accountGroupId: group.id, sortOrder: 3 })
  })

  it('システム管理の資産科目(立替金)もグループへ所属させられる', () => {
    const groupRepository = new SqlJsAccountGroupRepository(db)
    const group = groupRepository.create({ name: '一時勘定', category: 'asset' })
    const advance = repository.create({
      category: 'asset',
      name: '立替金',
      isReconcilable: false,
      isSystemManaged: true,
    })

    expect(repository.update(advance.id, { accountGroupId: group.id }).accountGroupId).toBe(group.id)
  })

  it('システム管理科目の無効化・削除は引き続き拒否される', () => {
    const systemManaged = repository.create({
      category: 'equity',
      name: '初期残高',
      isReconcilable: null,
      isSystemManaged: true,
    })

    expect(() => repository.deactivate(systemManaged.id)).toThrow()
    expect(() => repository.delete(systemManaged.id)).toThrow()
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
