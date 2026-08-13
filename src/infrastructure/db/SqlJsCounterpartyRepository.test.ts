/**
 * SqlJsCounterpartyRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/counterparties.md・
 * docs/schema/counterparties.sql に定義された取引先のライフサイクル(作成・参照・
 * 更新・削除・非アクティブ化)と、DDL側のトリガーが期待通り機能することを検証する。
 * パターン管理(addPattern/findByPattern)は SqlJsCounterpartyRepository.pattern.test.ts、
 * 統合(merge)は SqlJsCounterpartyRepository.merge.test.ts で扱う。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'

let db: Database
let repository: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsCounterpartyRepository(db)
})

describe('create / findById', () => {
  it('defaultAccountId省略時はnullで作成する', () => {
    const created = repository.create({ name: 'イオン' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: 'イオン',
      defaultAccountId: null,
      isActive: true,
    })
  })

  it('defaultAccountIdを指定して作成する', () => {
    const accountId = insertAccount(db, 'expense', '食費')

    const created = repository.create({ name: 'イオン', defaultAccountId: accountId })

    expect(created.defaultAccountId).toBe(accountId)
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全ての取引先を返す', () => {
    repository.create({ name: 'イオン' })
    repository.create({ name: 'Amazon' })

    const all = repository.findAll()

    expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(['イオン', 'Amazon']))
  })
})

describe('update', () => {
  it('名前を変更する', () => {
    const created = repository.create({ name: 'イオン' })

    const updated = repository.update(created.id, { name: 'イオン(改名)' })

    expect(updated.name).toBe('イオン(改名)')
  })

  it('defaultAccountIdを変更する(常に変更可能、accounts.categoryのような不可変制約はない)', () => {
    const created = repository.create({ name: 'イオン' })
    const accountId = insertAccount(db, 'expense', '食費')

    const updated = repository.update(created.id, { defaultAccountId: accountId })

    expect(updated.defaultAccountId).toBe(accountId)
  })

  it('defaultAccountIdにnullを指定すると初期値をクリアできる', () => {
    const accountId = insertAccount(db, 'expense', '食費')
    const created = repository.create({ name: 'イオン', defaultAccountId: accountId })

    const updated = repository.update(created.id, { defaultAccountId: null })

    expect(updated.defaultAccountId).toBeNull()
  })

  it('updated_atが更新される', () => {
    const created = repository.create({ name: '更新日時確認用取引先' })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE counterparties SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [
      created.id,
    ])

    const updated = repository.update(created.id, { name: '更新日時確認用取引先(改)' })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('紐づく仕訳明細が0件の取引先は物理削除できる', () => {
    const created = repository.create({ name: '紐づく参照がない取引先' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('journal_lines.counterparty_idから参照されている取引先の削除は拒否される', () => {
    const counterparty = repository.create({ name: '仕訳明細で参照されている取引先' })
    const accountId = insertAccount(db, 'expense', '食費')
    db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
    const memberId = lastInsertRowId(db)
    db.run(`INSERT INTO journal_entries (entry_date, household_member_id) VALUES ('2026-07-01', ?)`, [
      memberId,
    ])
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, counterparty_id, side, amount)
       VALUES (?, ?, ?, 'debit', 4000)`,
      [entryId, accountId, counterparty.id],
    )

    expect(() => repository.delete(counterparty.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('取引先を削除せず非アクティブにする', () => {
    const created = repository.create({ name: '閉店した取引先' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('is_activeの値によらず取引先を非アクティブにできる', () => {
    const created = repository.create({ name: '既に非アクティブな取引先' })
    repository.deactivate(created.id)

    const deactivatedAgain = repository.deactivate(created.id)

    expect(deactivatedAgain.isActive).toBe(false)
  })
})

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertAccount(database: Database, category: string, name: string): number {
  database.run(
    `INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)`,
    [category, name, category === 'asset' || category === 'liability' ? 1 : null],
  )
  return lastInsertRowId(database)
}
