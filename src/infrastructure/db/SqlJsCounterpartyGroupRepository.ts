import type { Database } from 'sql.js'
import type {
  CounterpartyGroup,
  CreateCounterpartyGroupInput,
  UpdateCounterpartyGroupInput,
} from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'

/**
 * CounterpartyGroupRepository(ドメイン層のポート)のsql.js実装(計画Issue #143)。
 * 中身(子グループ・所属取引先)があるグループの物理削除禁止・グループ名のユニーク制約は
 * DDL側(docs/schema/counterparties.sql)で強制され、制約違反時のsql.js例外はそのまま伝播する。
 * 親グループ変更時のみ、isDescendantGroupによる循環参照を事前に検証する。
 * sortOrder省略時は、同じ入れ物(親グループ、最上位なら全体)の既存のサブグループ・直属取引先の
 * どちらよりも後ろ(末尾)になるよう自動採番する。
 */
export class SqlJsCounterpartyGroupRepository implements CounterpartyGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateCounterpartyGroupInput): CounterpartyGroup {
    const parentGroupId = input.parentGroupId ?? null
    const sortOrder = input.sortOrder ?? this.nextSortOrder(parentGroupId)

    this.db.run('INSERT INTO counterparty_groups (name, parent_group_id, sort_order) VALUES (?, ?, ?)', [
      input.name,
      parentGroupId,
      sortOrder,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): CounterpartyGroup | null {
    const [result] = this.db.exec('SELECT * FROM counterparty_groups WHERE id = ?', [id])
    if (!result) return null
    return mapRowToCounterpartyGroup(result.columns, result.values[0])
  }

  findAll(): CounterpartyGroup[] {
    const [result] = this.db.exec('SELECT * FROM counterparty_groups ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToCounterpartyGroup(result.columns, values))
  }

  update(id: number, input: UpdateCounterpartyGroupInput): CounterpartyGroup {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`counterparty group not found: ${id}`)
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

    this.db.run('UPDATE counterparty_groups SET name = ?, parent_group_id = ?, sort_order = ? WHERE id = ?', [
      input.name ?? current.name,
      nextParentGroupId,
      nextSortOrder,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM counterparty_groups WHERE id = ?', [id])
  }

  deactivate(id: number): CounterpartyGroup {
    this.db.run('UPDATE counterparty_groups SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  /**
   * 指定した入れ物(parentGroupId。nullなら最上位)に既に存在するサブグループ・直属取引先の
   * sort_orderの最大値+1を返す。excludeGroupIdは自分自身を候補から除外するために使う(update時)。
   * 最上位の直属取引先は未分類の取引先を指し、グループの並びとは別の入れ物のため数えない。
   */
  private nextSortOrder(parentGroupId: number | null, excludeGroupId?: number): number {
    const excludeClause = excludeGroupId !== undefined ? ' AND id != ?' : ''
    const groupRows =
      parentGroupId === null
        ? this.db.exec(
            `SELECT MAX(sort_order) FROM counterparty_groups WHERE parent_group_id IS NULL${excludeClause}`,
            excludeGroupId !== undefined ? [excludeGroupId] : [],
          )
        : this.db.exec(
            `SELECT MAX(sort_order) FROM counterparty_groups WHERE parent_group_id = ?${excludeClause}`,
            excludeGroupId !== undefined ? [parentGroupId, excludeGroupId] : [parentGroupId],
          )
    const memberRows =
      parentGroupId === null
        ? []
        : this.db.exec('SELECT MAX(sort_order) FROM counterparties WHERE counterparty_group_id = ?', [
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

function mapRowToCounterpartyGroup(columns: string[], values: unknown[]): CounterpartyGroup {
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
