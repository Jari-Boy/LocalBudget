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
  it('creates an individual member (isGroup defaults to false) when isGroup is omitted', () => {
    const created = repository.create({ name: '夫' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '夫',
      isGroup: false,
      isActive: true,
    })
  })

  it('creates a group member when isGroup is explicitly true', () => {
    const created = repository.create({ name: '夫婦', isGroup: true })

    expect(created.isGroup).toBe(true)
  })

  it('returns null for an id that does not exist', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('returns every created member', () => {
    repository.create({ name: '夫' })
    repository.create({ name: '妻' })

    const all = repository.findAll()

    expect(all.map((m) => m.name)).toEqual(expect.arrayContaining(['夫', '妻']))
  })
})

describe('update', () => {
  it('changes the name', () => {
    const created = repository.create({ name: '夫' })

    const updated = repository.update(created.id, { name: '夫(改名)' })

    expect(updated.name).toBe('夫(改名)')
  })

  it('updates updated_at', () => {
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
  it('physically deletes a member with zero references', () => {
    const created = repository.create({ name: '紐づく参照がないメンバー' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('refuses to delete a member referenced by accounts.household_member_id', () => {
    const member = repository.create({ name: '口座名義になっているメンバー' })
    insertAccount(db, 'asset', '普通預金', member.id)

    expect(() => repository.delete(member.id)).toThrow()
  })

  it('refuses to delete a member referenced by journal_lines.household_member_id', () => {
    const member = repository.create({ name: '仕訳明細で参照されているメンバー' })
    const accountId = insertAccount(db, 'expense', '食費')
    db.run(`INSERT INTO journal_entries (entry_date) VALUES ('2026-07-01')`)
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
  it('marks the member inactive without deleting it', () => {
    const created = repository.create({ name: '引っ越したメンバー' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('deactivates a member regardless of its previous is_active value', () => {
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
