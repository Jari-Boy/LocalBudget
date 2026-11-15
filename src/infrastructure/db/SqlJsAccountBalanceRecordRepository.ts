import type { Database } from 'sql.js'
import type {
  AccountBalanceRecord,
  CreateAccountBalanceRecordInput,
  UpdateAccountBalanceRecordInput,
} from '../../domain/reconciliation/AccountBalanceRecord'
import type { AccountBalanceRecordRepository } from '../../domain/reconciliation/AccountBalanceRecordRepository'
import { reconcileAutoBalanceAdjustments } from './autoBalanceAdjustment'

/**
 * AccountBalanceRecordRepository(ドメイン層のポート)のsql.js実装(計画Issue #205)。
 * 追加・編集・削除はそれぞれ1つのトランザクションで行い、同じトランザクションの中で
 * 科目の自動調整仕訳を計算し直す。失敗したらROLLBACKし、記録だけ・調整だけが残る状態を作らない。
 * 同じ科目・同じ日の重複はDDLの一意制約が拒否し、その例外はそのまま呼び出し元に伝わる。
 */
export class SqlJsAccountBalanceRecordRepository implements AccountBalanceRecordRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateAccountBalanceRecordInput): AccountBalanceRecord {
    let id = 0
    this.inTransaction(() => {
      this.db.run('INSERT INTO account_balance_records (account_id, record_date, balance) VALUES (?, ?, ?)', [
        input.accountId,
        input.recordDate,
        input.balance,
      ])
      id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
      reconcileAutoBalanceAdjustments(this.db, [input.accountId])
    })
    return this.findById(id)!
  }

  update(id: number, input: UpdateAccountBalanceRecordInput): AccountBalanceRecord {
    const current = this.findById(id)
    if (!current) throw new Error(`account balance record not found: ${id}`)
    this.inTransaction(() => {
      this.db.run('UPDATE account_balance_records SET record_date = ?, balance = ? WHERE id = ?', [
        input.recordDate,
        input.balance,
        id,
      ])
      reconcileAutoBalanceAdjustments(this.db, [current.accountId])
    })
    return this.findById(id)!
  }

  delete(id: number): void {
    const current = this.findById(id)
    if (!current) return
    this.inTransaction(() => {
      this.db.run('DELETE FROM account_balance_records WHERE id = ?', [id])
      reconcileAutoBalanceAdjustments(this.db, [current.accountId])
    })
  }

  findByAccount(accountId: number): AccountBalanceRecord[] {
    const [result] = this.db.exec(
      'SELECT * FROM account_balance_records WHERE account_id = ? ORDER BY record_date',
      [accountId],
    )
    return (result?.values ?? []).map((row) => mapRow(result.columns, row))
  }

  private findById(id: number): AccountBalanceRecord | null {
    const [result] = this.db.exec('SELECT * FROM account_balance_records WHERE id = ?', [id])
    return result ? mapRow(result.columns, result.values[0]) : null
  }

  private inTransaction(work: () => void): void {
    this.db.run('BEGIN')
    try {
      work()
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }
}

function mapRow(columns: string[], values: unknown[]): AccountBalanceRecord {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    accountId: get<number>('account_id'),
    recordDate: get<string>('record_date'),
    balance: get<number>('balance'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
