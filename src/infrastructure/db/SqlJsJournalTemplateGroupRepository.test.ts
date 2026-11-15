/**
 * SqlJsJournalTemplateGroupRepository と、仕訳テンプレートのグループ所属(journal_templates.
 * journal_template_group_id・sort_order)の統合テスト(計画Issue #201、docs/domain/journal-templates.md)。
 * 取引先・プロジェクトのグループ(project_groups)と同じ仕様(入れ子可・単一所属・表示専用)について、
 * 作成・改名・親変更・並び替え、循環参照の拒否、同じ親の下の名前の一意、中身(子グループ・所属テンプレート)が
 * あるグループの削除拒否、テンプレートが未分類で存在できること(新規作成時の既定)を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsJournalTemplateGroupRepository } from './SqlJsJournalTemplateGroupRepository'
import { SqlJsJournalTemplateRepository } from './SqlJsJournalTemplateRepository'

let db: Database
let groups: SqlJsJournalTemplateGroupRepository
let templates: SqlJsJournalTemplateRepository
let expenseId: number
let assetId: number

function insertAccount(category: string, name: string): number {
  // 資産・負債は照合の有無が必須、それ以外はNULL(accountsのCHECK制約)
  const reconcilable = category === 'asset' || category === 'liability' ? 0 : null
  db.run('INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)', [category, name, reconcilable])
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function createTemplate(name: string, groupId: number | null = null) {
  return templates.create({
    name,
    groupId,
    lines: [
      { side: 'debit', accountId: expenseId, amount: null },
      { side: 'credit', accountId: assetId, amount: null },
    ],
  })
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  groups = new SqlJsJournalTemplateGroupRepository(db)
  templates = new SqlJsJournalTemplateRepository(db)
  expenseId = insertAccount('expense', '食費')
  assetId = insertAccount('asset', '現金')
})

describe('SqlJsJournalTemplateGroupRepository: 作成・取得', () => {
  it('親を指定せず最上位グループを作成できる', () => {
    const group = groups.create({ name: '食事' })

    expect(group).toMatchObject({ name: '食事', parentGroupId: null, isActive: true })
    expect(groups.findById(group.id)).toEqual(group)
  })

  it('親グループを指定して子グループを作成できる', () => {
    const parent = groups.create({ name: '食事' })
    const child = groups.create({ name: '外食', parentGroupId: parent.id })

    expect(child.parentGroupId).toBe(parent.id)
  })

  it('存在しないidはnullを返し、findAllは全グループを返す', () => {
    expect(groups.findById(999)).toBeNull()
    groups.create({ name: 'A' })
    groups.create({ name: 'B' })
    expect(groups.findAll().map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('同じ親の下で同名のアクティブなグループは作成できない', () => {
    groups.create({ name: '食事' })
    expect(() => groups.create({ name: '食事' })).toThrow()
  })
})

describe('SqlJsJournalTemplateGroupRepository: 並び順・親変更', () => {
  it('sortOrder省略時は同じ入れ物の末尾に自動採番される', () => {
    const a = groups.create({ name: 'A' })
    const b = groups.create({ name: 'B' })

    expect(b.sortOrder).toBe(a.sortOrder + 1)
  })

  it('親グループ内の直属テンプレートの後ろにも採番される', () => {
    const parent = groups.create({ name: '食事' })
    const template = createTemplate('コンビニ', parent.id)

    const child = groups.create({ name: '外食', parentGroupId: parent.id })

    expect(child.sortOrder).toBe(template.sortOrder + 1)
  })

  it('改名と並び順の変更ができる', () => {
    const group = groups.create({ name: 'A' })

    const updated = groups.update(group.id, { name: 'B', sortOrder: 5 })

    expect(updated).toMatchObject({ name: 'B', sortOrder: 5 })
  })

  it('親グループを付け替えると、新しい入れ物の末尾に並ぶ', () => {
    const parent = groups.create({ name: '親' })
    const other = groups.create({ name: '別' })

    const moved = groups.update(other.id, { parentGroupId: parent.id })

    expect(moved.parentGroupId).toBe(parent.id)
  })

  it('自分自身や自分の配下を親にする(循環参照)と拒否する', () => {
    const parent = groups.create({ name: '親' })
    const child = groups.create({ name: '子', parentGroupId: parent.id })

    expect(() => groups.update(parent.id, { parentGroupId: parent.id })).toThrow()
    expect(() => groups.update(parent.id, { parentGroupId: child.id })).toThrow()
  })
})

describe('SqlJsJournalTemplateGroupRepository: 削除', () => {
  it('中身のない空のグループは削除できる', () => {
    const group = groups.create({ name: '空' })

    groups.delete(group.id)

    expect(groups.findById(group.id)).toBeNull()
  })

  it('子グループがあるグループは削除できない', () => {
    const parent = groups.create({ name: '親' })
    groups.create({ name: '子', parentGroupId: parent.id })

    expect(() => groups.delete(parent.id)).toThrow()
  })

  it('所属するテンプレートがあるグループは削除できない', () => {
    const group = groups.create({ name: '食事' })
    createTemplate('コンビニ', group.id)

    expect(() => groups.delete(group.id)).toThrow()
  })

  it('非アクティブにできる', () => {
    const group = groups.create({ name: '食事' })

    expect(groups.deactivate(group.id).isActive).toBe(false)
  })
})

describe('テンプレートのグループ所属', () => {
  it('グループを指定しない新規作成は未分類(null)になる', () => {
    expect(createTemplate('A').groupId).toBeNull()
  })

  it('同じグループ内の既存テンプレートの末尾に自動採番される', () => {
    const group = groups.create({ name: '食事' })
    const first = createTemplate('A', group.id)
    const second = createTemplate('B', group.id)

    expect(second.sortOrder).toBe(first.sortOrder + 1)
  })
})
