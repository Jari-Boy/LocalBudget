import type { Database } from 'sql.js'
import type {
  AccountGroup,
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'

/**
 * AccountGroupRepository(ドメイン層のポート)のsql.js実装。
 * 子グループ・所属科目が存在するグループの物理削除禁止トリガー・グループ名の
 * ユニーク制約等のドメインルールはDDL側(docs/schema/accounts.sql)で強制されるため、
 * ここでは制約違反時にsql.jsの例外がそのまま呼び出し元に伝播する。
 * 親グループ変更時のみ、ドメイン層のisDescendantGroup(祖先探索の純粋関数)を使い、
 * 新しい親が自分自身の子孫でないことを事前に検証する(docs/domain/accounts.md 3.3節
 * 「循環参照の防止はRepository層で行う」)。
 */
export class SqlJsAccountGroupRepository implements AccountGroupRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateAccountGroupInput): AccountGroup {
    this.db.run('INSERT INTO account_groups (name, parent_group_id) VALUES (?, ?)', [
      input.name,
      input.parentGroupId ?? null,
    ])
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

    if (
      input.parentGroupId !== undefined &&
      input.parentGroupId !== null &&
      isDescendantGroup(this.findAll(), id, input.parentGroupId)
    ) {
      throw new Error('cannot set a descendant group (or itself) as the parent group')
    }

    this.db.run('UPDATE account_groups SET name = ?, parent_group_id = ? WHERE id = ?', [
      input.name ?? current.name,
      input.parentGroupId === undefined ? current.parentGroupId : input.parentGroupId,
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
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
