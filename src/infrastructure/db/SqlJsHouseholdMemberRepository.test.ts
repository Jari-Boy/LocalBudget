/**
 * SqlJsHouseholdMemberRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/household-members.md・
 * docs/schema/household_members.sql に定義された世帯メンバーのライフサイクル(作成・参照・
 * 更新・削除・非アクティブ化)と、DDL側のトリガーが期待通り機能することを検証する。
 * グループ機能(所属管理・ネスト禁止)は SqlJsHouseholdMemberRepository.group.test.ts で扱う。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'

let db: Database
let repository: SqlJsHouseholdMemberRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsHouseholdMemberRepository(db)
})

describe('create / findById', () => {
  it('isGroup省略時はデフォルト(false)の個人メンバーとして作成する', () => {
    const created = repository.create({ name: '夫' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '夫',
      isGroup: false,
      isActive: true,
    })
  })

  it('isGroupにtrueを明示するとグループメンバーとして作成する', () => {
    const created = repository.create({ name: '夫婦', isGroup: true })

    expect(created.isGroup).toBe(true)
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全てのメンバーを返す', () => {
    repository.create({ name: '夫' })
    repository.create({ name: '妻' })

    const all = repository.findAll()

    expect(all.map((m) => m.name)).toEqual(expect.arrayContaining(['夫', '妻']))
  })
})

describe('update', () => {
  it('名前を変更する', () => {
    const created = repository.create({ name: '夫' })

    const updated = repository.update(created.id, { name: '夫(改名)' })

    expect(updated.name).toBe('夫(改名)')
  })

  it('isGroupに現在と同じ値を渡した場合は成功する', () => {
    const created = repository.create({ name: '夫', isGroup: false })

    const updated = repository.update(created.id, { isGroup: false })

    expect(updated.isGroup).toBe(false)
  })

  it('isGroupを現在と異なる値に変更しようとすると拒否される(is_group変更禁止トリガー、household-members.md 1.5節)', () => {
    const created = repository.create({ name: '夫', isGroup: false })

    expect(() => repository.update(created.id, { isGroup: true })).toThrow()
  })

  it('updated_atが更新される', () => {
    const created = repository.create({ name: '更新日時確認用メンバー' })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE household_members SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [
      created.id,
    ])

    const updated = repository.update(created.id, { name: '更新日時確認用メンバー(改)' })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('紐づく参照が0件のメンバーは物理削除できる', () => {
    const created = repository.create({ name: '紐づく参照がないメンバー' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('accounts.household_member_idから参照されているメンバーの削除は拒否される', () => {
    const member = repository.create({ name: '口座名義になっているメンバー' })
    insertAccount(db, 'asset', '普通預金', member.id)

    expect(() => repository.delete(member.id)).toThrow()
  })

  it('journal_lines.household_member_idから参照されているメンバーの削除は拒否される', () => {
    const member = repository.create({ name: '仕訳明細で参照されているメンバー' })
    const accountId = insertAccount(db, 'expense', '食費')
    db.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [
      member.id,
    ])
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
       VALUES (?, ?, ?, 'debit', 4000)`,
      [entryId, accountId, member.id],
    )

    expect(() => repository.delete(member.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('メンバーを削除せず非アクティブにする', () => {
    const created = repository.create({ name: '引っ越したメンバー' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('is_activeの値によらずメンバーを非アクティブにできる', () => {
    const created = repository.create({ name: '既に非アクティブなメンバー' })
    repository.deactivate(created.id)

    const deactivatedAgain = repository.deactivate(created.id)

    expect(deactivatedAgain.isActive).toBe(false)
  })
})

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertAccount(
  database: Database,
  category: string,
  name: string,
  householdMemberId?: number,
): number {
  database.run(
    `INSERT INTO accounts (category, name, is_reconcilable, household_member_id)
     VALUES (?, ?, ?, ?)`,
    [category, name, category === 'asset' || category === 'liability' ? 1 : null, householdMemberId ?? null],
  )
  return lastInsertRowId(database)
}
