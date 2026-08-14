import type { Database } from 'sql.js'
import type { Budget, CreateBudgetInput, UpdateBudgetInput } from '../../domain/budget/Budget'
import type { BudgetRepository } from '../../domain/budget/BudgetRepository'

/**
 * BudgetRepository(ドメイン層のポート)のsql.js実装。
 * expense区分の科目のみ許可するトリガー・同一科目/同一年月のUNIQUE制約等の
 * ドメインルールはDDL側(docs/schema/budgets.sql)で強制されるため、
 * ここでは制約違反時にsql.jsの例外がそのまま呼び出し元に伝播する(docs/domain/budgets.md参照)。
 */
export class SqlJsBudgetRepository implements BudgetRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateBudgetInput): Budget {
    this.db.run('INSERT INTO budgets (account_id, year_month, amount) VALUES (?, ?, ?)', [
      input.accountId,
      input.yearMonth,
      input.amount,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): Budget | null {
    const [result] = this.db.exec('SELECT * FROM budgets WHERE id = ?', [id])
    if (!result) return null
    return mapRowToBudget(result.columns, result.values[0])
  }

  findByAccountAndYearMonth(accountId: number, yearMonth: string): Budget | null {
    const [result] = this.db.exec(
      'SELECT * FROM budgets WHERE account_id = ? AND year_month = ?',
      [accountId, yearMonth],
    )
    if (!result) return null
    return mapRowToBudget(result.columns, result.values[0])
  }

  findByYearMonth(yearMonth: string): Budget[] {
    const [result] = this.db.exec(
      'SELECT * FROM budgets WHERE year_month = ? ORDER BY id',
      [yearMonth],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToBudget(result.columns, values))
  }

  findAll(): Budget[] {
    const [result] = this.db.exec('SELECT * FROM budgets ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToBudget(result.columns, values))
  }

  update(id: number, input: UpdateBudgetInput): Budget {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`budget not found: ${id}`)
    }

    this.db.run('UPDATE budgets SET amount = ? WHERE id = ?', [input.amount, id])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM budgets WHERE id = ?', [id])
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToBudget(columns: string[], values: unknown[]): Budget {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    accountId: get<number>('account_id'),
    yearMonth: get<string>('year_month'),
    amount: get<number>('amount'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
