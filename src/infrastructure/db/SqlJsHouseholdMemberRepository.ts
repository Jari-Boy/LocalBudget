import type { Database } from 'sql.js'
import type {
  CreateHouseholdMemberInput,
  HouseholdMember,
  UpdateHouseholdMemberInput,
} from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'

/**
 * HouseholdMemberRepository(ドメイン層のポート)のsql.js実装。
 * is_groupの変更禁止・グループのネスト禁止・紐づく勘定科目/仕訳明細が存在するメンバーの
 * 物理削除禁止トリガー等のドメインルールはDDL側の制約/トリガー(docs/schema/household_members.sql)
 * で強制されるため、ここでは制約違反時にsql.jsの例外がそのまま呼び出し元に伝播する
 * (docs/domain/household-members.md参照)。
 */
export class SqlJsHouseholdMemberRepository implements HouseholdMemberRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateHouseholdMemberInput): HouseholdMember {
    if (input.isGroup === undefined) {
      this.db.run('INSERT INTO household_members (name) VALUES (?)', [input.name])
    } else {
      this.db.run('INSERT INTO household_members (name, is_group) VALUES (?, ?)', [
        input.name,
        input.isGroup ? 1 : 0,
      ])
    }
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): HouseholdMember | null {
    const [result] = this.db.exec('SELECT * FROM household_members WHERE id = ?', [id])
    if (!result) return null
    return mapRowToHouseholdMember(result.columns, result.values[0])
  }

  findAll(): HouseholdMember[] {
    const [result] = this.db.exec('SELECT * FROM household_members ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToHouseholdMember(result.columns, values))
  }

  update(id: number, input: UpdateHouseholdMemberInput): HouseholdMember {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`household member not found: ${id}`)
    }

    if (input.isGroup === undefined) {
      this.db.run('UPDATE household_members SET name = ? WHERE id = ?', [
        input.name ?? current.name,
        id,
      ])
    } else {
      this.db.run('UPDATE household_members SET name = ?, is_group = ? WHERE id = ?', [
        input.name ?? current.name,
        input.isGroup ? 1 : 0,
        id,
      ])
    }
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM household_members WHERE id = ?', [id])
  }

  deactivate(id: number): HouseholdMember {
    this.db.run('UPDATE household_members SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  addGroupMember(groupId: number, memberId: number): void {
    this.db.run(
      'INSERT INTO household_member_group_memberships (group_id, member_id) VALUES (?, ?)',
      [groupId, memberId],
    )
  }

  removeGroupMember(groupId: number, memberId: number): void {
    this.db.run(
      'DELETE FROM household_member_group_memberships WHERE group_id = ? AND member_id = ?',
      [groupId, memberId],
    )
  }

  findGroupMembers(groupId: number): HouseholdMember[] {
    const [result] = this.db.exec(
      `SELECT hm.* FROM household_members hm
       INNER JOIN household_member_group_memberships gm ON gm.member_id = hm.id
       WHERE gm.group_id = ?
       ORDER BY hm.id`,
      [groupId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToHouseholdMember(result.columns, values))
  }
}

function sqlToBool(value: number): boolean {
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToHouseholdMember(columns: string[], values: unknown[]): HouseholdMember {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    isGroup: sqlToBool(get<number>('is_group')),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
