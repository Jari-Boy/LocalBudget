import type { Database } from 'sql.js'
import type {
  CreateJournalTemplateGroupInput,
  JournalTemplateGroup,
  UpdateJournalTemplateGroupInput,
} from '../../domain/journal-template-group/JournalTemplateGroup'
import type { JournalTemplateGroupRepository } from '../../domain/journal-template-group/JournalTemplateGroupRepository'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'

/**
 * JournalTemplateGroupRepository(ドメイン層のポート)のsql.js実装(計画Issue #201)。
 * 中身(子グループ・所属テンプレート)があるグループの物理削除禁止・同じ親の下の名前の一意は
 * DDL側(docs/schema/journal_templates.sql)で強制され、制約違反時のsql.js例外はそのまま伝播する。
 * 親グループ変更時のみ、isDescendantGroupによる循環参照を事前に検証する。
 * sortOrder省略時は、同じ入れ物(親グループ、最上位なら全体)の既存のサブグループ・直属テンプレートの
 * どちらよりも後ろ(末尾)になるよう自動採番する(SqlJsProjectGroupRepositoryと同じ)。
 */
export class SqlJsJournalTemplateGroupRepository implements JournalTemplateGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateJournalTemplateGroupInput): JournalTemplateGroup {
    const parentGroupId = input.parentGroupId ?? null
    const sortOrder = input.sortOrder ?? this.nextSortOrder(parentGroupId)

    this.db.run('INSERT INTO journal_template_groups (name, parent_group_id, sort_order) VALUES (?, ?, ?)', [
      input.name,
      parentGroupId,
      sortOrder,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): JournalTemplateGroup | null {
    const [result] = this.db.exec('SELECT * FROM journal_template_groups WHERE id = ?', [id])
    if (!result) return null
    return mapRowToGroup(result.columns, result.values[0])
  }

  findAll(): JournalTemplateGroup[] {
    const [result] = this.db.exec('SELECT * FROM journal_template_groups ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToGroup(result.columns, values))
  }

  update(id: number, input: UpdateJournalTemplateGroupInput): JournalTemplateGroup {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`journal template group not found: ${id}`)
    }

    const nextParentGroupId =
      input.parentGroupId === undefined ? current.parentGroupId : input.parentGroupId
    const isReparenting = nextParentGroupId !== current.parentGroupId

    if (isReparenting && nextParentGroupId !== null) {
      if (isDescendantGroup(this.findAll(), id, nextParentGroupId)) {
        throw new Error('cannot set a descendant group (or itself) as the parent group')
      }
    }

    const nextSortOrder =
      input.sortOrder !== undefined
        ? input.sortOrder
        : isReparenting
          ? this.nextSortOrder(nextParentGroupId, id)
          : current.sortOrder

    this.db.run('UPDATE journal_template_groups SET name = ?, parent_group_id = ?, sort_order = ? WHERE id = ?', [
      input.name ?? current.name,
      nextParentGroupId,
      nextSortOrder,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM journal_template_groups WHERE id = ?', [id])
  }

  deactivate(id: number): JournalTemplateGroup {
    this.db.run('UPDATE journal_template_groups SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  /**
   * 指定した入れ物(parentGroupId。nullなら最上位)に既に存在するサブグループ・直属テンプレートの
   * sort_orderの最大値+1を返す。excludeGroupIdは自分自身を候補から除外するために使う(update時)。
   * 最上位の直属テンプレートは未分類のテンプレートを指し、グループの並びとは別の入れ物のため数えない。
   */
  private nextSortOrder(parentGroupId: number | null, excludeGroupId?: number): number {
    const excludeClause = excludeGroupId !== undefined ? ' AND id != ?' : ''
    const groupRows =
      parentGroupId === null
        ? this.db.exec(
            `SELECT MAX(sort_order) FROM journal_template_groups WHERE parent_group_id IS NULL${excludeClause}`,
            excludeGroupId !== undefined ? [excludeGroupId] : [],
          )
        : this.db.exec(
            `SELECT MAX(sort_order) FROM journal_template_groups WHERE parent_group_id = ?${excludeClause}`,
            excludeGroupId !== undefined ? [parentGroupId, excludeGroupId] : [parentGroupId],
          )
    const memberRows =
      parentGroupId === null
        ? []
        : this.db.exec('SELECT MAX(sort_order) FROM journal_templates WHERE journal_template_group_id = ?', [
            parentGroupId,
          ])

    const groupMax = (groupRows[0]?.values[0]?.[0] as number | null) ?? null
    const memberMax = (memberRows[0]?.values[0]?.[0] as number | null) ?? null
    return Math.max(groupMax ?? -1, memberMax ?? -1) + 1
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToGroup(columns: string[], values: unknown[]): JournalTemplateGroup {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    parentGroupId: get<number | null>('parent_group_id'),
    sortOrder: get<number>('sort_order'),
    isActive: get<number>('is_active') !== 0,
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
