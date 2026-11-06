/**
 * SqlJsCounterpartyGroupRepository と、取引先のグループ所属(counterparties.counterparty_group_id・
 * sort_order)の統合テスト(計画Issue #143、docs/domain/counterparties.md のグループ節)。
 * 勘定科目グループ(account_groups)と同じ仕様(入れ子可・単一所属・表示専用)の取引先版について、
 * 作成・改名・削除・親変更・並び替え、循環参照の拒否、中身(子グループ・所属取引先)があるグループの
 * 削除拒否、取引先が未分類で存在できること(CSV取込で作られる取引先の既定)を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsCounterpartyGroupRepository } from './SqlJsCounterpartyGroupRepository'
import { SqlJsCounterpartyRepository } from './SqlJsCounterpartyRepository'

let db: Database
let groups: SqlJsCounterpartyGroupRepository
let counterparties: SqlJsCounterpartyRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  groups = new SqlJsCounterpartyGroupRepository(db)
  counterparties = new SqlJsCounterpartyRepository(db)
})

describe('SqlJsCounterpartyGroupRepository: 作成・取得', () => {
  it('親を指定せず最上位グループを作成できる', () => {
    const group = groups.create({ name: 'スーパー' })

    expect(group).toMatchObject({ name: 'スーパー', parentGroupId: null, isActive: true })
    expect(groups.findById(group.id)).toEqual(group)
  })

  it('親グループを指定して子グループを作成できる', () => {
    const parent = groups.create({ name: '食料品店' })
    const child = groups.create({ name: 'スーパー', parentGroupId: parent.id })

    expect(child.parentGroupId).toBe(parent.id)
  })

  it('存在しないidに対してはnullを返し、findAllは全グループを返す', () => {
    expect(groups.findById(999)).toBeNull()
    groups.create({ name: 'A' })
    groups.create({ name: 'B' })
    expect(groups.findAll().map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('同じ親の下で同名のアクティブなグループは作成できない', () => {
    groups.create({ name: 'スーパー' })
    expect(() => groups.create({ name: 'スーパー' })).toThrow()
  })
})

describe('SqlJsCounterpartyGroupRepository: 並び順', () => {
  it('sortOrder省略時は同じ入れ物の末尾に自動採番される', () => {
    const a = groups.create({ name: 'A' })
    const b = groups.create({ name: 'B' })

    expect(b.sortOrder).toBe(a.sortOrder + 1)
  })

  it('子グループの末尾追加は、同じ親の既存のサブグループ・直属の取引先のどちらよりも後ろになる', () => {
    const parent = groups.create({ name: '親' })
    counterparties.create({ name: 'イオン', counterpartyGroupId: parent.id, sortOrder: 5 })

    const child = groups.create({ name: '子', parentGroupId: parent.id })

    expect(child.sortOrder).toBe(6)
  })

  it('sortOrderを明示して作成でき、updateで変更できる', () => {
    const group = groups.create({ name: 'A', sortOrder: 3 })
    expect(group.sortOrder).toBe(3)

    expect(groups.update(group.id, { sortOrder: 9 }).sortOrder).toBe(9)
  })

  it('名前のみの変更ではsortOrderは変化せず、親を変えてsortOrder未指定なら移動先の末尾になる', () => {
    const target = groups.create({ name: '移動先' })
    counterparties.create({ name: 'x', counterpartyGroupId: target.id, sortOrder: 4 })
    const moving = groups.create({ name: '移動する', sortOrder: 0 })

    expect(groups.update(moving.id, { name: '改名' }).sortOrder).toBe(0)
    expect(groups.update(moving.id, { parentGroupId: target.id }).sortOrder).toBe(5)
  })
})

describe('SqlJsCounterpartyGroupRepository: 改名・親変更', () => {
  it('名前を変更できる', () => {
    const group = groups.create({ name: '旧' })
    expect(groups.update(group.id, { name: '新' }).name).toBe('新')
  })

  it('親を変更でき、nullにして最上位へ戻せる', () => {
    const parent = groups.create({ name: '親' })
    const group = groups.create({ name: '子' })

    expect(groups.update(group.id, { parentGroupId: parent.id }).parentGroupId).toBe(parent.id)
    expect(groups.update(group.id, { parentGroupId: null }).parentGroupId).toBeNull()
  })

  it('自分自身を親に指定すると循環参照として拒否される', () => {
    const group = groups.create({ name: 'A' })
    expect(() => groups.update(group.id, { parentGroupId: group.id })).toThrow(/descendant|itself/)
  })

  it('自分の子・孫を親に指定すると循環参照として拒否される', () => {
    const a = groups.create({ name: 'A' })
    const b = groups.create({ name: 'B', parentGroupId: a.id })
    const c = groups.create({ name: 'C', parentGroupId: b.id })

    expect(() => groups.update(a.id, { parentGroupId: b.id })).toThrow(/descendant|itself/)
    expect(() => groups.update(a.id, { parentGroupId: c.id })).toThrow(/descendant|itself/)
  })

  it('存在しないグループの更新はエラーになる', () => {
    expect(() => groups.update(999, { name: 'x' })).toThrow('counterparty group not found')
  })
})

describe('SqlJsCounterpartyGroupRepository: 削除・非アクティブ化', () => {
  it('中身のないグループは物理削除できる', () => {
    const group = groups.create({ name: 'A' })
    groups.delete(group.id)
    expect(groups.findById(group.id)).toBeNull()
  })

  it('子グループを持つグループの削除は拒否される', () => {
    const parent = groups.create({ name: '親' })
    groups.create({ name: '子', parentGroupId: parent.id })
    expect(() => groups.delete(parent.id)).toThrow()
  })

  it('所属する取引先があるグループの削除は拒否される', () => {
    const group = groups.create({ name: 'スーパー' })
    counterparties.create({ name: 'イオン', counterpartyGroupId: group.id })
    expect(() => groups.delete(group.id)).toThrow()
  })

  it('グループを非アクティブにできる', () => {
    const group = groups.create({ name: 'A' })
    expect(groups.deactivate(group.id).isActive).toBe(false)
  })
})

describe('取引先のグループ所属', () => {
  it('グループ未指定で作成した取引先は未分類(groupId = null)になる(CSV取込で作られる取引先の既定)', () => {
    const counterparty = counterparties.create({ name: 'セブン' })
    expect(counterparty.counterpartyGroupId).toBeNull()
  })

  it('グループを指定して作成でき、updateでグループ変更・未分類への戻し・並び替えができる', () => {
    const g1 = groups.create({ name: 'G1' })
    const g2 = groups.create({ name: 'G2' })
    const c = counterparties.create({ name: 'イオン', counterpartyGroupId: g1.id })
    expect(c.counterpartyGroupId).toBe(g1.id)

    expect(counterparties.update(c.id, { counterpartyGroupId: g2.id }).counterpartyGroupId).toBe(g2.id)
    expect(counterparties.update(c.id, { sortOrder: 7 }).sortOrder).toBe(7)
    expect(counterparties.update(c.id, { counterpartyGroupId: null }).counterpartyGroupId).toBeNull()
  })

  it('グループ変更では取引先のその他の項目(名前)は変わらない', () => {
    const g = groups.create({ name: 'G' })
    const c = counterparties.create({ name: 'イオン' })
    expect(counterparties.update(c.id, { counterpartyGroupId: g.id }).name).toBe('イオン')
  })
})
