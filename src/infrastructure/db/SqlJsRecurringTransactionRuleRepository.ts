import type { Database } from 'sql.js'
import type {
  CreateRecurringTransactionRuleInput,
  RecurringAmountMode,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  UpdateRecurringTransactionRuleInput,
  WeekendAdjustment,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { assertValidRecurringSchedule } from '../../domain/recurring-transaction/assertValidRecurringSchedule'
import { isRecurringRuleEnded } from '../../domain/recurring-transaction/isRecurringRuleEnded'

/**
 * RecurringTransactionRuleRepository(ドメイン層のポート)のsql.js実装。
 * frequencyごとのカラム組み合わせは書き込み直前にassertValidRecurringSchedule(DBアクセス
 * 不要な純粋な整合性検証)で検証し、InvalidRecurringScheduleErrorをスローする
 * (docs/domain/recurring-transactions.md 1.3、SqlJsJournalEntryRepositoryのassertJournalBalance
 * と同じ使い分け)。is_reconcilable科目を借方/貸方に指定できないトリガー・生成済み仕訳がある
 * 場合の物理削除禁止トリガー等、DBルックアップを要する制約はDDL側
 * (docs/schema/recurring_transactions.sql)に委ね、違反時はsql.jsの例外がそのまま呼び出し元に
 * 伝播する。開始日は省略すると今日になり、終了日・間隔・土日の調整・金額の初期値の既定値はDDLに従う
 * (終了なし・1回ごと・調整なし・固定、計画Issue #164)。
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
         project_id, household_member_id, counterparty_id, max_occurrences,
         starts_on, ends_on, interval, weekend_adjustment, amount_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.startsOn ?? todayIso(),
        input.endsOn ?? null,
        input.interval ?? 1,
        input.weekendAdjustment ?? 'none',
        input.amountMode ?? 'fixed',
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
    const current = this.findById(id)
    if (!current) {
      throw new Error(`recurring transaction rule not found: ${id}`)
    }
    // 指定されなかった開始日・終了日・間隔は現在の値のまま更新されるため、その値で検証する
    assertValidRecurringSchedule({
      ...input,
      startsOn: input.startsOn ?? current.startsOn,
      endsOn: input.endsOn === undefined ? current.endsOn : input.endsOn,
      interval: input.interval ?? current.interval,
    })

    this.db.run(
      `UPDATE recurring_transaction_rules SET
        name = ?, debit_account_id = ?, credit_account_id = ?, amount = ?, frequency = ?,
        day_of_week = ?, day_of_month = ?, week_of_month = ?, month_of_year = ?,
        project_id = ?, household_member_id = ?, counterparty_id = ?, max_occurrences = ?,
        starts_on = ?, ends_on = ?, interval = ?, weekend_adjustment = ?, amount_mode = ?
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
        input.startsOn ?? current.startsOn,
        input.endsOn === undefined ? current.endsOn : input.endsOn,
        input.interval ?? current.interval,
        input.weekendAdjustment ?? current.weekendAdjustment,
        input.amountMode ?? current.amountMode,
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

  activate(id: number, resumedOn: string, asOf: string = todayIso()): RecurringTransactionRule {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`recurring transaction rule not found: ${id}`)
    }
    if (isRecurringRuleEnded(current, this.countGeneratedJournalEntries(id), asOf)) {
      throw new Error(`recurring transaction rule ${id} has ended and cannot be activated; extend its end date instead`)
    }
    this.db.run('UPDATE recurring_transaction_rules SET is_active = 1, resumed_on = ? WHERE id = ?', [resumedOn, id])
    return this.findById(id)!
  }

  countGeneratedJournalEntries(id: number): number {
    const [result] = this.db.exec(
      'SELECT COUNT(*) AS count FROM journal_entries WHERE generated_from_rule_id = ?',
      [id],
    )
    return result!.values[0][0] as number
  }

  findLatestGeneratedDueDate(id: number): string | null {
    const [result] = this.db.exec(
      'SELECT MAX(recurring_due_date) AS latest FROM journal_entries WHERE generated_from_rule_id = ?',
      [id],
    )
    return (result!.values[0][0] as string | null) ?? null
  }

  findLastConfirmedAmount(id: number): number | null {
    const [latest] = this.db.exec(
      `SELECT id FROM journal_entries
       WHERE generated_from_rule_id = ?
       ORDER BY recurring_due_date DESC LIMIT 1`,
      [id],
    )
    if (!latest) return null
    const [sum] = this.db.exec(
      `SELECT SUM(amount) FROM journal_lines WHERE journal_entry_id = ? AND side = 'debit'`,
      [latest.values[0][0] as number],
    )
    return (sum?.values[0][0] as number | null) ?? null
  }

  recordSkip(id: number, dueDate: string): void {
    this.db.run('INSERT INTO recurring_transaction_skips (rule_id, due_date) VALUES (?, ?)', [id, dueDate])
  }

  findLatestSkippedDueDate(id: number): string | null {
    const [result] = this.db.exec(
      'SELECT MAX(due_date) AS latest FROM recurring_transaction_skips WHERE rule_id = ?',
      [id],
    )
    return (result!.values[0][0] as string | null) ?? null
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
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
    startsOn: get<string>('starts_on'),
    endsOn: get<string | null>('ends_on'),
    interval: get<number>('interval'),
    weekendAdjustment: get<WeekendAdjustment>('weekend_adjustment'),
    amountMode: get<RecurringAmountMode>('amount_mode'),
    resumedOn: get<string | null>('resumed_on'),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
