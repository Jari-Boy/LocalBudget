import type { Database } from 'sql.js'
import type {
  Account,
  AccountCategory,
  CreateAccountInput,
  UpdateAccountInput,
} from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'

/**
 * AccountRepository(ドメイン層のポート)のsql.js実装。
 * 区分の変更・equity区分の作成制限・ユニーク制約等のドメインルールはDDL側の
 * CHECK制約/トリガー(docs/schema/accounts.sql)で強制されるため、ここでは
 * 制約違反時にsql.jsの例外がそのまま呼び出し元に伝播する(docs/domain/accounts.md参照)。
 */
export class SqlJsAccountRepository implements AccountRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateAccountInput): Account {
    this.db.run(
      `INSERT INTO accounts
        (category, name, is_reconcilable, is_system_managed,
         household_member_id, account_group_id, initial_balance_for_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.category,
        input.name,
        boolToSql(input.isReconcilable),
        boolToSql(input.isSystemManaged ?? false),
        input.householdMemberId ?? null,
        input.accountGroupId ?? null,
        input.initialBalanceForAccountId ?? null,
      ],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): Account | null {
    const [result] = this.db.exec('SELECT * FROM accounts WHERE id = ?', [id])
    if (!result) return null
    return mapRowToAccount(result.columns, result.values[0])
  }

  findAll(): Account[] {
    const [result] = this.db.exec('SELECT * FROM accounts ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToAccount(result.columns, values))
  }

  update(id: number, input: UpdateAccountInput): Account {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`account not found: ${id}`)
    }

    this.db.run(
      `UPDATE accounts SET name = ?, household_member_id = ?, account_group_id = ? WHERE id = ?`,
      [
        input.name ?? current.name,
        input.householdMemberId === undefined
          ? current.householdMemberId
          : input.householdMemberId,
        input.accountGroupId === undefined ? current.accountGroupId : input.accountGroupId,
        id,
      ],
    )
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM accounts WHERE id = ?', [id])
  }

  deactivate(id: number): Account {
    this.db.run('UPDATE accounts SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }
}

function boolToSql(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null
  return value ? 1 : 0
}

function sqlToBool(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToAccount(columns: string[], values: unknown[]): Account {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    category: get<AccountCategory>('category'),
    name: get<string>('name'),
    isReconcilable: sqlToBool(get<number | null>('is_reconcilable')),
    isActive: sqlToBool(get<number>('is_active')) as boolean,
    isSystemManaged: sqlToBool(get<number>('is_system_managed')) as boolean,
    householdMemberId: get<number | null>('household_member_id'),
    accountGroupId: get<number | null>('account_group_id'),
    initialBalanceForAccountId: get<number | null>('initial_balance_for_account_id'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
