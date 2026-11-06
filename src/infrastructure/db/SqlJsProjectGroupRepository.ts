import type { Database } from 'sql.js'
import type {
  ProjectGroup,
  CreateProjectGroupInput,
  UpdateProjectGroupInput,
} from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'

/**
 * ProjectGroupRepository(ドメイン層のポート)のsql.js実装(計画Issue #143)。
 * 中身(子グループ・所属プロジェクト)があるグループの物理削除禁止・グループ名のユニーク制約は
 * DDL側(docs/schema/projects.sql)で強制され、制約違反時のsql.js例外はそのまま伝播する。
 * 親グループ変更時のみ、isDescendantGroupによる循環参照を事前に検証する。
 * sortOrder省略時は、同じ入れ物(親グループ、最上位なら全体)の既存のサブグループ・直属プロジェクトの
 * どちらよりも後ろ(末尾)になるよう自動採番する。
 */
export class SqlJsProjectGroupRepository implements ProjectGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateProjectGroupInput): ProjectGroup {
    const parentGroupId = input.parentGroupId ?? null
    const sortOrder = input.sortOrder ?? this.nextSortOrder(parentGroupId)

    this.db.run('INSERT INTO project_groups (name, parent_group_id, sort_order) VALUES (?, ?, ?)', [
      input.name,
      parentGroupId,
      sortOrder,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): ProjectGroup | null {
    const [result] = this.db.exec('SELECT * FROM project_groups WHERE id = ?', [id])
    if (!result) return null
    return mapRowToProjectGroup(result.columns, result.values[0])
  }

  findAll(): ProjectGroup[] {
    const [result] = this.db.exec('SELECT * FROM project_groups ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToProjectGroup(result.columns, values))
  }

  update(id: number, input: UpdateProjectGroupInput): ProjectGroup {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`project group not found: ${id}`)
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

    this.db.run('UPDATE project_groups SET name = ?, parent_group_id = ?, sort_order = ? WHERE id = ?', [
      input.name ?? current.name,
      nextParentGroupId,
      nextSortOrder,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM project_groups WHERE id = ?', [id])
  }

  deactivate(id: number): ProjectGroup {
    this.db.run('UPDATE project_groups SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  /**
   * 指定した入れ物(parentGroupId。nullなら最上位)に既に存在するサブグループ・直属プロジェクトの
   * sort_orderの最大値+1を返す。excludeGroupIdは自分自身を候補から除外するために使う(update時)。
   * 最上位の直属プロジェクトは未分類のプロジェクトを指し、グループの並びとは別の入れ物のため数えない。
   */
  private nextSortOrder(parentGroupId: number | null, excludeGroupId?: number): number {
    const excludeClause = excludeGroupId !== undefined ? ' AND id != ?' : ''
    const groupRows =
      parentGroupId === null
        ? this.db.exec(
            `SELECT MAX(sort_order) FROM project_groups WHERE parent_group_id IS NULL${excludeClause}`,
            excludeGroupId !== undefined ? [excludeGroupId] : [],
          )
        : this.db.exec(
            `SELECT MAX(sort_order) FROM project_groups WHERE parent_group_id = ?${excludeClause}`,
            excludeGroupId !== undefined ? [parentGroupId, excludeGroupId] : [parentGroupId],
          )
    const memberRows =
      parentGroupId === null
        ? []
        : this.db.exec('SELECT MAX(sort_order) FROM projects WHERE project_group_id = ?', [
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

function mapRowToProjectGroup(columns: string[], values: unknown[]): ProjectGroup {
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
