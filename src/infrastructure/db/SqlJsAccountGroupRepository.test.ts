/**
 * SqlJsAccountGroupRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/accounts.md 3.3節・
 * docs/schema/accounts.sql に定義された勘定科目グループのライフサイクル(作成・参照・
 * 更新・削除・非アクティブ化)、親グループによる入れ子構造、循環参照の検出
 * (isDescendantGroupをRepository層から呼び出す)、DDL側のCHECK制約・トリガーが
 * 期待通り機能することを検証する。計画Issue #129で追加されたcategory(作成時確定・
 * 以後不変、親子は常に同一category)・sortOrder(同一入れ物内での表示順、省略時は
 * 末尾へ自動追加)も対象に含む。外部依存: sql.js(ネットワークアクセスなし)。
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
    const created = repository.create({ name: '水道光熱費', category: 'expense' })

    const found = repository.findById(created.id)

    expect(found).toMatchObject({
      id: created.id,
      name: '水道光熱費',
      parentGroupId: null,
      category: 'expense',
      isActive: true,
    })
  })

  it('親グループを指定して子グループを作成する(親と同一category)', () => {
    const parent = repository.create({ name: '固定費', category: 'expense' })

    const child = repository.create({
      name: 'クレジットカード',
      category: 'expense',
      parentGroupId: parent.id,
    })

    expect(child.parentGroupId).toBe(parent.id)
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })
})

describe('findAll', () => {
  it('作成した全てのグループを返す', () => {
    repository.create({ name: '水道光熱費', category: 'expense' })
    repository.create({ name: '通信費', category: 'expense' })

    const all = repository.findAll()

    expect(all.map((g) => g.name)).toEqual(expect.arrayContaining(['水道光熱費', '通信費']))
  })
})

describe('category(計画Issue #129)', () => {
  it('作成したグループのcategoryが保存される', () => {
    const created = repository.create({ name: '現金同等物', category: 'asset' })

    expect(repository.findById(created.id)?.category).toBe('asset')
  })

  it('親グループと異なるcategoryの子グループを新規作成しようとすると拒否される', () => {
    const parent = repository.create({ name: '固定費', category: 'expense' })

    expect(() =>
      repository.create({ name: '現金同等物', category: 'asset', parentGroupId: parent.id }),
    ).toThrow()
  })

  it('親グループの変更先が異なるcategoryの場合は拒否される', () => {
    const expenseGroup = repository.create({ name: '固定費', category: 'expense' })
    const assetGroup = repository.create({ name: '現金同等物', category: 'asset' })
    const child = repository.create({
      name: 'サブ',
      category: 'expense',
      parentGroupId: expenseGroup.id,
    })

    expect(() => repository.update(child.id, { parentGroupId: assetGroup.id })).toThrow()
  })

  it('同一categoryの親グループへの変更は成功する', () => {
    const oldParent = repository.create({ name: '固定費', category: 'expense' })
    const newParent = repository.create({ name: '変動費', category: 'expense' })
    const child = repository.create({
      name: 'サブ',
      category: 'expense',
      parentGroupId: oldParent.id,
    })

    const updated = repository.update(child.id, { parentGroupId: newParent.id })

    expect(updated.parentGroupId).toBe(newParent.id)
  })
})

describe('sortOrder(計画Issue #129)', () => {
  it('指定しない場合、同じ入れ物(最上位ならcategory)の末尾に自動的に追加される', () => {
    const first = repository.create({ name: '現金同等物', category: 'asset' })
    const second = repository.create({ name: '住居', category: 'asset' })

    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('異なるcategoryの最上位グループ同士はsortOrderの採番が独立している', () => {
    repository.create({ name: '現金同等物', category: 'asset' })
    repository.create({ name: '住居', category: 'asset' })
    const firstLiability = repository.create({ name: 'クレカ', category: 'liability' })

    expect(firstLiability.sortOrder).toBe(0)
  })

  it('子グループの末尾追加は、同じ親の既存のサブグループ・直属科目のどちらよりも後ろになる', () => {
    const parent = repository.create({ name: '現金同等物', category: 'asset' })
    db.run(
      `INSERT INTO accounts (category, name, is_reconcilable, account_group_id, sort_order)
       VALUES ('asset', '現金', 1, ?, 5)`,
      [parent.id],
    )

    const child = repository.create({ name: 'ネット銀行', category: 'asset', parentGroupId: parent.id })

    expect(child.sortOrder).toBeGreaterThan(5)
  })

  it('sortOrderを明示的に指定して作成できる', () => {
    const created = repository.create({ name: 'テスト', category: 'expense', sortOrder: 42 })

    expect(created.sortOrder).toBe(42)
  })

  it('updateでsortOrderを明示的に指定した値へ変更できる', () => {
    const created = repository.create({ name: 'テスト', category: 'expense' })

    const updated = repository.update(created.id, { sortOrder: 7 })

    expect(updated.sortOrder).toBe(7)
  })

  it('parentGroupIdを変更してsortOrderを指定しない場合、移動先の末尾に自動的に追加される', () => {
    const oldParent = repository.create({ name: '固定費', category: 'expense' })
    const newParent = repository.create({ name: '変動費', category: 'expense' })
    repository.create({ name: '既存の子', category: 'expense', parentGroupId: newParent.id, sortOrder: 3 })
    const moved = repository.create({ name: '移動対象', category: 'expense', parentGroupId: oldParent.id })

    const updated = repository.update(moved.id, { parentGroupId: newParent.id })

    expect(updated.sortOrder).toBeGreaterThan(3)
  })

  it('名前のみの変更ではsortOrderは変化しない', () => {
    const created = repository.create({ name: '水道光熱費', category: 'expense', sortOrder: 9 })

    const updated = repository.update(created.id, { name: '光熱費' })

    expect(updated.sortOrder).toBe(9)
  })
})

describe('update', () => {
  it('名前を変更する', () => {
    const created = repository.create({ name: '水道光熱費', category: 'expense' })

    const updated = repository.update(created.id, { name: '光熱費' })

    expect(updated.name).toBe('光熱費')
  })

  it('親グループを変更する', () => {
    const oldParent = repository.create({ name: '固定費', category: 'expense' })
    const newParent = repository.create({ name: '変動費', category: 'expense' })
    const child = repository.create({
      name: 'クレジットカード',
      category: 'expense',
      parentGroupId: oldParent.id,
    })

    const updated = repository.update(child.id, { parentGroupId: newParent.id })

    expect(updated.parentGroupId).toBe(newParent.id)
  })

  it('親グループをnullにして最上位に戻す', () => {
    const parent = repository.create({ name: '固定費', category: 'expense' })
    const child = repository.create({
      name: 'クレジットカード',
      category: 'expense',
      parentGroupId: parent.id,
    })

    const updated = repository.update(child.id, { parentGroupId: null })

    expect(updated.parentGroupId).toBeNull()
  })

  it('自分自身を親に指定すると循環参照として拒否される', () => {
    const group = repository.create({ name: '固定費', category: 'expense' })

    expect(() => repository.update(group.id, { parentGroupId: group.id })).toThrow()
  })

  it('自分の子を親に指定すると循環参照として拒否される', () => {
    const parent = repository.create({ name: '固定費', category: 'expense' })
    const child = repository.create({
      name: 'クレジットカード',
      category: 'expense',
      parentGroupId: parent.id,
    })

    expect(() => repository.update(parent.id, { parentGroupId: child.id })).toThrow()
  })

  it('自分の孫(多階層)を親に指定すると循環参照として拒否される', () => {
    const grandparent = repository.create({ name: '固定費', category: 'expense' })
    const parent = repository.create({
      name: 'クレジットカード',
      category: 'expense',
      parentGroupId: grandparent.id,
    })
    const grandchild = repository.create({
      name: '楽天カード',
      category: 'expense',
      parentGroupId: parent.id,
    })

    expect(() => repository.update(grandparent.id, { parentGroupId: grandchild.id })).toThrow()
  })

  it('updated_atが更新される', () => {
    const created = repository.create({ name: '更新日時確認用グループ', category: 'expense' })
    db.run(`UPDATE account_groups SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [created.id])

    const updated = repository.update(created.id, { name: '更新日時確認用グループ(改)' })

    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('delete', () => {
  it('子グループ・所属科目がともに0件のグループは物理削除できる', () => {
    const created = repository.create({ name: '水道光熱費', category: 'expense' })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
  })

  it('子グループを持つグループの削除は拒否される', () => {
    const parent = repository.create({ name: '固定費', category: 'expense' })
    repository.create({ name: 'クレジットカード', category: 'expense', parentGroupId: parent.id })

    expect(() => repository.delete(parent.id)).toThrow()
  })

  it('所属する勘定科目があるグループの削除は拒否される', () => {
    const group = repository.create({ name: '水道光熱費', category: 'expense' })
    db.run(
      `INSERT INTO accounts (category, name, is_reconcilable, account_group_id) VALUES ('expense', '電気代', NULL, ?)`,
      [group.id],
    )

    expect(() => repository.delete(group.id)).toThrow()
  })
})

describe('deactivate', () => {
  it('グループを削除せず非アクティブにする', () => {
    const created = repository.create({ name: '使わなくなった分類', category: 'expense' })

    const deactivated = repository.deactivate(created.id)

    expect(deactivated.isActive).toBe(false)
    expect(repository.findById(created.id)).not.toBeNull()
  })

  it('is_activeの値によらずグループを非アクティブにできる', () => {
    const created = repository.create({ name: '既に非アクティブなグループ', category: 'expense' })
    repository.deactivate(created.id)

    const deactivatedAgain = repository.deactivate(created.id)

    expect(deactivatedAgain.isActive).toBe(false)
  })
})
