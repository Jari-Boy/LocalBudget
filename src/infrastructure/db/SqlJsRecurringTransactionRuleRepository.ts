import type { Database } from 'sql.js'
import type {
  CreateRecurringTransactionRuleInput,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  UpdateRecurringTransactionRuleInput,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { assertValidRecurringSchedule } from '../../domain/recurring-transaction/assertValidRecurringSchedule'

/**
 * RecurringTransactionRuleRepository(ドメイン層のポート)のsql.js実装。
 * frequencyごとのカラム組み合わせは書き込み直前にassertValidRecurringSchedule(DBアクセス
 * 不要な純粋な整合性検証)で検証し、InvalidRecurringScheduleErrorをスローする
 * (docs/domain/recurring-transactions.md 1.3、SqlJsJournalEntryRepositoryのassertJournalBalance
 * と同じ使い分け)。is_reconcilable科目を借方/貸方に指定できないトリガー・生成済み仕訳がある
 * 場合の物理削除禁止トリガー等、DBルックアップを要する制約はDDL側
 * (docs/schema/recurring_transactions.sql)に委ね、違反時はsql.jsの例外がそのまま呼び出し元に
 * 伝播する。
 */
export class SqlJsRecurringTransactionRuleRepository implements RecurringTransactionRuleRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateRecurringTransactionRuleInput): RecurringTransactionRule {
    assertValidRecurringSchedule(input)

    this.db.run(
      `INSERT INTO recurring_transaction_rules
        (name, debit_account_id, credit_account_id, amount, frequency,
         day_of_week, day_of_month, week_of_month, month_of_year,
         project_id, household_member_id, counterparty_id, max_occurrences)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name,
        input.debitAccountId,
        input.creditAccountId,
        input.amount,
        input.frequency,
        input.dayOfWeek ?? null,
        input.dayOfMonth ?? null,
        input.weekOfMonth ?? null,
        input.monthOfYear ?? null,
        input.projectId ?? null,
        input.householdMemberId ?? null,
        input.counterpartyId ?? null,
        input.maxOccurrences ?? null,
      ],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): RecurringTransactionRule | null {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules WHERE id = ?', [id])
    if (!result) return null
    return mapRowToRule(result.columns, result.values[0])
  }

  findAll(): RecurringTransactionRule[] {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToRule(result.columns, values))
  }

  update(id: number, input: UpdateRecurringTransactionRuleInput): RecurringTransactionRule {
    assertValidRecurringSchedule(input)

    const current = this.findById(id)
    if (!current) {
      throw new Error(`recurring transaction rule not found: ${id}`)
    }

    this.db.run(
      `UPDATE recurring_transaction_rules SET
        name = ?, debit_account_id = ?, credit_account_id = ?, amount = ?, frequency = ?,
        day_of_week = ?, day_of_month = ?, week_of_month = ?, month_of_year = ?,
        project_id = ?, household_member_id = ?, counterparty_id = ?, max_occurrences = ?
       WHERE id = ?`,
      [
        input.name,
        input.debitAccountId,
        input.creditAccountId,
        input.amount,
        input.frequency,
        input.dayOfWeek ?? null,
        input.dayOfMonth ?? null,
        input.weekOfMonth ?? null,
        input.monthOfYear ?? null,
        input.projectId ?? null,
        input.householdMemberId ?? null,
        input.counterpartyId ?? null,
        input.maxOccurrences ?? null,
        id,
      ],
    )
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM recurring_transaction_rules WHERE id = ?', [id])
  }

  deactivate(id: number): RecurringTransactionRule {
    this.db.run('UPDATE recurring_transaction_rules SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  countGeneratedJournalEntries(id: number): number {
    const [result] = this.db.exec(
      'SELECT COUNT(*) AS count FROM journal_entries WHERE generated_from_rule_id = ?',
      [id],
    )
    return result!.values[0][0] as number
  }
}

function sqlToBool(value: number): boolean {
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToRule(columns: string[], values: unknown[]): RecurringTransactionRule {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    debitAccountId: get<number>('debit_account_id'),
    creditAccountId: get<number>('credit_account_id'),
    amount: get<number>('amount'),
    frequency: get<RecurringTransactionFrequency>('frequency'),
    dayOfWeek: get<number | null>('day_of_week'),
    dayOfMonth: get<number | null>('day_of_month'),
    weekOfMonth: get<number | null>('week_of_month'),
    monthOfYear: get<number | null>('month_of_year'),
    projectId: get<number | null>('project_id'),
    householdMemberId: get<number | null>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    maxOccurrences: get<number | null>('max_occurrences'),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
