/**
 * SqlJsAccountGroupRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/accounts.md 3.3節・
 * docs/schema/accounts.sql に定義された勘定科目グループのライフサイクル(作成・参照・
 * 更新・削除・非アクティブ化)、親グループによる入れ子構造、循環参照の検出
 * (isDescendantGroupをRepository層から呼び出す)、DDL側のCHECK制約・トリガーが
 * 期待通り機能することを検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'

let db: Database
let repository: SqlJsAccountGroupRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountGroupRepository(db)
})

describe('create / findById', () => {
  it('親グループを指定せず最上位グループを作成する', () => {
    const created = repository.create({ name: '水道光熱費' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '水道光熱費',
      parentGroupId: null,
      isActive: true,
    })
  })

  it('親グループを指定して子グループを作成する', () => {
    const parent = repository.create({ name: '固定費' })

    const child = repository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    expect(child.parentGroupId).toBe(parent.id)
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全てのグループを返す', () => {
    repository.create({ name: '水道光熱費' })
    repository.create({ name: '通信費' })

    const all = repository.findAll()

    expect(all.map((g) => g.name)).toEqual(expect.arrayContaining(['水道光熱費', '通信費']))
  })
})

describe('update', () => {
  it('名前を変更する', () => {
    const created = repository.create({ name: '水道光熱費' })

    const updated = repository.update(created.id, { name: '光熱費' })

    expect(updated.name).toBe('光熱費')
  })

  it('親グループを変更する', () => {
    const oldParent = repository.create({ name: '固定費' })
    const newParent = repository.create({ name: '変動費' })
    const child = repository.create({ name: 'クレジットカード', parentGroupId: oldParent.id })

    const updated = repository.update(child.id, { parentGroupId: newParent.id })

    expect(updated.parentGroupId).toBe(newParent.id)
  })

  it('親グループをnullにして最上位に戻す', () => {
    const parent = repository.create({ name: '固定費' })
    const child = repository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    const updated = repository.update(child.id, { parentGroupId: null })

    expect(updated.parentGroupId).toBeNull()
  })

  it('自分自身を親に指定すると循環参照として拒否される', () => {
    const group = repository.create({ name: '固定費' })

    expect(() => repository.update(group.id, { parentGroupId: group.id })).toThrow()
  })

  it('自分の子を親に指定すると循環参照として拒否される', () => {
    const parent = repository.create({ name: '固定費' })
    const child = repository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    expect(() => repository.update(parent.id, { parentGroupId: child.id })).toThrow()
  })

  it('自分の孫(多階層)を親に指定すると循環参照として拒否される', () => {
    const grandparent = repository.create({ name: '固定費' })
    const parent = repository.create({ name: 'クレジットカード', parentGroupId: grandparent.id })
    const grandchild = repository.create({ name: '楽天カード', parentGroupId: parent.id })

    expect(() => repository.update(grandparent.id, { parentGroupId: grandchild.id })).toThrow()
  })

  it('updated_atが更新される', () => {
    const created = repository.create({ name: '更新日時確認用グループ' })
    db.run(`UPDATE account_groups SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [created.id])

    const updated = repository.update(created.id, { name: '更新日時確認用グループ(改)' })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('子グループ・所属科目がともに0件のグループは物理削除できる', () => {
    const created = repository.create({ name: '水道光熱費' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('子グループを持つグループの削除は拒否される', () => {
    const parent = repository.create({ name: '固定費' })
    repository.create({ name: 'クレジットカード', parentGroupId: parent.id })

    expect(() => repository.delete(parent.id)).toThrow()
  })

  it('所属する勘定科目があるグループの削除は拒否される', () => {
    const group = repository.create({ name: '水道光熱費' })
    db.run(
      `INSERT INTO accounts (category, name, is_reconcilable, account_group_id) VALUES ('expense', '電気代', NULL, ?)`,
      [group.id],
    )

    expect(() => repository.delete(group.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('グループを削除せず非アクティブにする', () => {
    const created = repository.create({ name: '使わなくなった分類' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('is_activeの値によらずグループを非アクティブにできる', () => {
    const created = repository.create({ name: '既に非アクティブなグループ' })
    repository.deactivate(created.id)

    const deactivatedAgain = repository.deactivate(created.id)

    expect(deactivatedAgain.isActive).toBe(false)
  })
})
