/**
 * SqlJsProjectGroupRepository と、プロジェクトのグループ所属(projects.project_group_id・
 * sort_order)の統合テスト(計画Issue #143、docs/domain/projects.md のグループ節)。
 * 勘定科目グループ(account_groups)と同じ仕様(入れ子可・単一所属・表示専用)のプロジェクト版について、
 * 作成・改名・削除・親変更・並び替え、循環参照の拒否、中身(子グループ・所属プロジェクト)があるグループの
 * 削除拒否、プロジェクトが未分類で存在できること(新規作成時の既定)を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsProjectGroupRepository } from './SqlJsProjectGroupRepository'
import { SqlJsProjectRepository } from './SqlJsProjectRepository'

let db: Database
let groups: SqlJsProjectGroupRepository
let projects: SqlJsProjectRepository

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  groups = new SqlJsProjectGroupRepository(db)
  projects = new SqlJsProjectRepository(db)
})

describe('SqlJsProjectGroupRepository: 作成・取得', () => {
  it('親を指定せず最上位グループを作成できる', () => {
    const group = groups.create({ name: '旅行' })

    expect(group).toMatchObject({ name: '旅行', parentGroupId: null, isActive: true })
    expect(groups.findById(group.id)).toEqual(group)
  })

  it('親グループを指定して子グループを作成できる', () => {
    const parent = groups.create({ name: 'イベント' })
    const child = groups.create({ name: '旅行', parentGroupId: parent.id })

    expect(child.parentGroupId).toBe(parent.id)
  })

  it('存在しないidに対してはnullを返し、findAllは全グループを返す', () => {
    expect(groups.findById(999)).toBeNull()
    groups.create({ name: 'A' })
    groups.create({ name: 'B' })
    expect(groups.findAll().map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('同じ親の下で同名のアクティブなグループは作成できない', () => {
    groups.create({ name: '旅行' })
    expect(() => groups.create({ name: '旅行' })).toThrow()
  })
})

describe('SqlJsProjectGroupRepository: 並び順', () => {
  it('sortOrder省略時は同じ入れ物の末尾に自動採番される', () => {
    const a = groups.create({ name: 'A' })
    const b = groups.create({ name: 'B' })

    expect(b.sortOrder).toBe(a.sortOrder + 1)
  })

  it('子グループの末尾追加は、同じ親の既存のサブグループ・直属のプロジェクトのどちらよりも後ろになる', () => {
    const parent = groups.create({ name: '親' })
    projects.create({ name: '沖縄旅行', projectGroupId: parent.id, sortOrder: 5 })

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
    projects.create({ name: 'x', projectGroupId: target.id, sortOrder: 4 })
    const moving = groups.create({ name: '移動する', sortOrder: 0 })

    expect(groups.update(moving.id, { name: '改名' }).sortOrder).toBe(0)
    expect(groups.update(moving.id, { parentGroupId: target.id }).sortOrder).toBe(5)
  })
})

describe('SqlJsProjectGroupRepository: 改名・親変更', () => {
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
    expect(() => groups.update(999, { name: 'x' })).toThrow('project group not found')
  })
})

describe('SqlJsProjectGroupRepository: 削除・非アクティブ化', () => {
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

  it('所属するプロジェクトがあるグループの削除は拒否される', () => {
    const group = groups.create({ name: '旅行' })
    projects.create({ name: '沖縄旅行', projectGroupId: group.id })
    expect(() => groups.delete(group.id)).toThrow()
  })

  it('グループを非アクティブにできる', () => {
    const group = groups.create({ name: 'A' })
    expect(groups.deactivate(group.id).isActive).toBe(false)
  })
})

describe('プロジェクトのグループ所属', () => {
  it('グループ未指定で作成したプロジェクトは未分類(groupId = null)になる(新規作成時の既定)', () => {
    const project = projects.create({ name: '北海道旅行' })
    expect(project.projectGroupId).toBeNull()
  })

  it('グループを指定して作成でき、updateでグループ変更・未分類への戻し・並び替えができる', () => {
    const g1 = groups.create({ name: 'G1' })
    const g2 = groups.create({ name: 'G2' })
    const c = projects.create({ name: '沖縄旅行', projectGroupId: g1.id })
    expect(c.projectGroupId).toBe(g1.id)

    expect(projects.update(c.id, { projectGroupId: g2.id }).projectGroupId).toBe(g2.id)
    expect(projects.update(c.id, { sortOrder: 7 }).sortOrder).toBe(7)
    expect(projects.update(c.id, { projectGroupId: null }).projectGroupId).toBeNull()
  })

  it('グループ変更ではプロジェクトのその他の項目(名前)は変わらない', () => {
    const g = groups.create({ name: 'G' })
    const c = projects.create({ name: '沖縄旅行' })
    expect(projects.update(c.id, { projectGroupId: g.id }).name).toBe('沖縄旅行')
  })
})
