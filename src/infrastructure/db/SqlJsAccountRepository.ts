import type { Database } from 'sql.js'
import type {
  Account,
  AccountCategory,
  CreateAccountInput,
  UpdateAccountInput,
  UpdateAccountOptions,
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
        (category, name, is_reconcilable, has_external_statement, is_system_managed,
         household_member_id, account_group_id, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.category,
        input.name,
        boolToSql(input.isReconcilable),
        boolToSql(resolveHasExternalStatement(input)),
        boolToSql(input.isSystemManaged ?? false),
        input.householdMemberId ?? null,
        input.accountGroupId ?? null,
        input.sortOrder ?? 0,
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

  update(id: number, input: UpdateAccountInput, options: UpdateAccountOptions = {}): Account {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`account not found: ${id}`)
    }

    const nextMemberId =
      input.householdMemberId === undefined ? current.householdMemberId : input.householdMemberId

    // 科目の更新と過去の明細行の更新は同時に行う(片方だけ反映された状態を残さない)。
    // 先に科目の既定値を変えてから明細行を更新するのは、UPDATEトリガが「明細行のメンバーを変える場合は
    // 科目の既定値と一致すること」を求めるため(docs/schema/journal.sql)
    this.db.run('BEGIN')
    try {
      this.db.run(
        `UPDATE accounts SET name = ?, household_member_id = ?, account_group_id = ?, sort_order = ? WHERE id = ?`,
        [
          input.name ?? current.name,
          nextMemberId,
          input.accountGroupId === undefined ? current.accountGroupId : input.accountGroupId,
          input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
          id,
        ],
      )
      if (options.updateExistingLines === true && nextMemberId !== null) {
        this.db.run(`UPDATE journal_lines SET household_member_id = ? WHERE account_id = ?`, [nextMemberId, id])
      }
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM accounts WHERE id = ?', [id])
  }

  deactivate(id: number): Account {
    this.db.run('UPDATE accounts SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  activate(id: number): Account {
    this.db.run('UPDATE accounts SET is_active = 1 WHERE id = ?', [id])
    return this.findById(id)!
  }

  merge(targetId: number, sourceIds: number[]): void {
    this.db.run('BEGIN')
    try {
      if (sourceIds.length === 0) {
        throw new Error('merge requires at least one source account')
      }
      const target = this.findById(targetId)
      if (!target) {
        throw new Error(`account not found: ${targetId}`)
      }
      if (target.isSystemManaged) {
        throw new Error(`system-managed account cannot be merged: ${targetId}`)
      }
      if (!target.isActive) {
        throw new Error(`inactive account cannot be a merge target: ${targetId}`)
      }

      for (const sourceId of sourceIds) {
        const source = this.findById(sourceId)
        if (!source) {
          throw new Error(`account not found: ${sourceId}`)
        }
        if (sourceId === targetId) {
          throw new Error(`merge source must differ from target: ${sourceId}`)
        }
        if (source.isSystemManaged) {
          throw new Error(`system-managed account cannot be merged: ${sourceId}`)
        }
        if (source.category !== target.category || source.isReconcilable !== target.isReconcilable) {
          throw new Error(`accounts of different category or reconcilability cannot be merged: ${sourceId}`)
        }

        const [result] = this.db.exec('SELECT COUNT(*) FROM journal_lines WHERE account_id = ?', [sourceId])
        const lineCount = result.values[0][0] as number

        this.db.run('UPDATE journal_lines SET account_id = ? WHERE account_id = ?', [targetId, sourceId])
        this.db.run(
          `INSERT INTO account_merge_log
             (target_account_id, target_account_name, source_account_id, source_account_name, line_count)
           VALUES (?, ?, ?, ?, ?)`,
          [targetId, target.name, sourceId, source.name, lineCount],
        )
      }

      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }
}

/** 資産・負債は、省略時に照合可否から決める(照合する科目は外部明細あり)。それ以外はnull */
function resolveHasExternalStatement(input: CreateAccountInput): boolean | null {
  if (input.category !== 'asset' && input.category !== 'liability') return null
  return input.hasExternalStatement ?? input.isReconcilable === true
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
    hasExternalStatement: sqlToBool(get<number | null>('has_external_statement')),
    isActive: sqlToBool(get<number>('is_active')) as boolean,
    isSystemManaged: sqlToBool(get<number>('is_system_managed')) as boolean,
    householdMemberId: get<number | null>('household_member_id'),
    accountGroupId: get<number | null>('account_group_id'),
    sortOrder: get<number>('sort_order'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
