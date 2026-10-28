import type { Database } from 'sql.js'
import type {
  AccountGroup,
  AccountGroupCategory,
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'

/**
 * AccountGroupRepository(ドメイン層のポート)のsql.js実装。
 * 子グループ・所属科目が存在するグループの物理削除禁止トリガー・グループ名の
 * ユニーク制約・category不変/親子同一category等のドメインルールはDDL側
 * (docs/schema/accounts.sql)で強制されるため、ここでは制約違反時にsql.jsの例外が
 * そのまま呼び出し元に伝播する。親グループ変更時のみ、ドメイン層のisDescendantGroup
 * (祖先探索の純粋関数)とcategory一致を事前に検証する(docs/domain/accounts.md 3.3節
 * 「循環参照の防止はRepository層で行う」、計画Issue #129でcategory一致検証を追加)。
 * sortOrder省略時は、同じ入れ物(親グループ、最上位ならcategory)に既に存在する
 * サブグループ・直属科目のどちらよりも後ろ(末尾)になるよう自動採番する。
 */
export class SqlJsAccountGroupRepository implements AccountGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateAccountGroupInput): AccountGroup {
    const parentGroupId = input.parentGroupId ?? null
    const sortOrder = input.sortOrder ?? this.nextSortOrder(parentGroupId, input.category)

    this.db.run(
      'INSERT INTO account_groups (name, parent_group_id, category, sort_order) VALUES (?, ?, ?, ?)',
      [input.name, parentGroupId, input.category, sortOrder],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): AccountGroup | null {
    const [result] = this.db.exec('SELECT * FROM account_groups WHERE id = ?', [id])
    if (!result) return null
    return mapRowToAccountGroup(result.columns, result.values[0])
  }

  findAll(): AccountGroup[] {
    const [result] = this.db.exec('SELECT * FROM account_groups ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToAccountGroup(result.columns, values))
  }

  update(id: number, input: UpdateAccountGroupInput): AccountGroup {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`account group not found: ${id}`)
    }

    const nextParentGroupId =
      input.parentGroupId === undefined ? current.parentGroupId : input.parentGroupId
    const isReparenting = nextParentGroupId !== current.parentGroupId

    if (isReparenting && nextParentGroupId !== null) {
      if (isDescendantGroup(this.findAll(), id, nextParentGroupId)) {
        throw new Error('cannot set a descendant group (or itself) as the parent group')
      }
      const newParent = this.findById(nextParentGroupId)
      if (newParent && newParent.category !== current.category) {
        throw new Error('account group category must match its parent group category')
      }
    }

    const nextSortOrder =
      input.sortOrder !== undefined
        ? input.sortOrder
        : isReparenting
          ? this.nextSortOrder(nextParentGroupId, current.category, id)
          : current.sortOrder

    this.db.run('UPDATE account_groups SET name = ?, parent_group_id = ?, sort_order = ? WHERE id = ?', [
      input.name ?? current.name,
      nextParentGroupId,
      nextSortOrder,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM account_groups WHERE id = ?', [id])
  }

  deactivate(id: number): AccountGroup {
    this.db.run('UPDATE account_groups SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  /**
   * 指定した入れ物(parentGroupId。nullなら最上位でcategoryにより絞り込む)に既に
   * 存在するサブグループ・直属科目(accounts)のsort_orderの最大値+1を返す
   * (計画Issue #129、グループと科目が1つの表示順を共有するため両方のテーブルを見る)。
   * excludeGroupIdは自分自身の現在のsort_orderを候補から除外するために使う(update時)。
   */
  private nextSortOrder(
    parentGroupId: number | null,
    category: AccountGroupCategory,
    excludeGroupId?: number,
  ): number {
    const groupRows =
      parentGroupId === null
        ? this.db.exec(
            `SELECT MAX(sort_order) AS m FROM account_groups
             WHERE parent_group_id IS NULL AND category = ?${excludeGroupId !== undefined ? ' AND id != ?' : ''}`,
            excludeGroupId !== undefined ? [category, excludeGroupId] : [category],
          )
        : this.db.exec(
            `SELECT MAX(sort_order) AS m FROM account_groups
             WHERE parent_group_id = ?${excludeGroupId !== undefined ? ' AND id != ?' : ''}`,
            excludeGroupId !== undefined ? [parentGroupId, excludeGroupId] : [parentGroupId],
          )
    const accountRows =
      parentGroupId === null
        ? [{ columns: ['m'], values: [[null]] }]
        : this.db.exec('SELECT MAX(sort_order) AS m FROM accounts WHERE account_group_id = ?', [
            parentGroupId,
          ])

    const groupMax = (groupRows[0]?.values[0]?.[0] as number | null) ?? null
    const accountMax = (accountRows[0]?.values[0]?.[0] as number | null) ?? null
    const max = Math.max(groupMax ?? -1, accountMax ?? -1)
    return max + 1
  }
}

function sqlToBool(value: number): boolean {
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToAccountGroup(columns: string[], values: unknown[]): AccountGroup {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    parentGroupId: get<number | null>('parent_group_id'),
    category: get<AccountGroupCategory>('category'),
    sortOrder: get<number>('sort_order'),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
