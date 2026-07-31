/**
 * SqlJsProjectRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/projects.md・
 * docs/schema/projects.sql に定義されたプロジェクトのライフサイクル(作成・参照・更新・
 * 削除・非アクティブ化)と、DDL側のCHECK制約・トリガーが期待通り機能することを検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'

let db: Database
let repository: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsProjectRepository(db)
})

describe('create / findById', () => {
  it('creates a project with the default kind (event) when kind is omitted', () => {
    const created = repository.create({ name: '26年7月アメリカ旅行' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '26年7月アメリカ旅行',
      kind: 'event',
      isActive: true,
    })
  })

  it('creates a project with an explicit kind (settlement)', () => {
    const created = repository.create({ name: 'スマホ24回払い', kind: 'settlement' })

    expect(created.kind).toBe('settlement')
  })

  it('returns null for an id that does not exist', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('returns every created project', () => {
    repository.create({ name: '26年7月アメリカ旅行' })
    repository.create({ name: '妹への貸付', kind: 'settlement' })

    const all = repository.findAll()

    expect(all.map((p) => p.name)).toEqual(
      expect.arrayContaining(['26年7月アメリカ旅行', '妹への貸付']),
    )
  })
})

describe('update', () => {
  it('changes the name', () => {
    const created = repository.create({ name: '26年7月アメリカ旅行' })

    const updated = repository.update(created.id, { name: '26年7月家族旅行' })

    expect(updated.name).toBe('26年7月家族旅行')
  })

  it('updates updated_at', () => {
    const created = repository.create({ name: '更新日時確認用プロジェクト' })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE projects SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [created.id])

    const updated = repository.update(created.id, { name: '更新日時確認用プロジェクト(改)' })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('physically deletes a project with zero journal lines referencing it', () => {
    const created = repository.create({ name: '紐づく仕訳がないプロジェクト' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('refuses to delete a project referenced by journal_lines', () => {
    const project = repository.create({ name: '紐づく仕訳があるプロジェクト' })
    const accountId = insertAccount(db, 'expense', 'お土産代')
    db.run(`INSERT INTO journal_entries (entry_date) VALUES ('2026-07-01')`)
    const entryId = lastInsertRowId(db)
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, project_id, side, amount)
       VALUES (?, ?, ?, 'debit', 5000)`,
      [entryId, accountId, project.id],
    )

    expect(() => repository.delete(project.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('marks the project inactive without deleting it', () => {
    const created = repository.create({ name: '旅行が終わったプロジェクト' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('deactivates a project regardless of its previous is_active value', () => {
    const created = repository.create({ name: '既に非アクティブなプロジェクト' })
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
    `INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, NULL)`,
    [category, name],
  )
  return lastInsertRowId(database)
}
