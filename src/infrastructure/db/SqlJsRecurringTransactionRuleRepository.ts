import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { assertJournalBalance } from '../../domain/journal/assertJournalBalance'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import type {
  CreateRecurringTransactionRuleInput,
  RecurringAmountMode,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  RecurringTransactionRuleLine,
  RecurringTransactionRuleLineInput,
  UpdateRecurringTransactionRuleInput,
  WeekendAdjustment,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { LastConfirmedLine } from '../../domain/recurring-transaction/resolveLastConfirmedLines'
import { assertValidRecurringSchedule } from '../../domain/recurring-transaction/assertValidRecurringSchedule'
import { isRecurringRuleEnded } from '../../domain/recurring-transaction/isRecurringRuleEnded'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'

/**
 * RecurringTransactionRuleRepository(ドメイン層のポート)のsql.js実装。
 * frequencyごとのカラム組み合わせは書き込み直前にassertValidRecurringSchedule(DBアクセス
 * 不要な純粋な整合性検証)で検証し、InvalidRecurringScheduleErrorをスローする
 * (docs/domain/recurring-transactions.md 1.3、SqlJsJournalEntryRepositoryのassertJournalBalance
 * と同じ使い分け)。ルールの行(recurring_transaction_rule_lines、計画Issue #180)は、貸借の一致と
 * 2行以上を仕訳と同じ検証(assertJournalBalance)で、精算バッチの付く科目をisSettlementBatchTaggableAccount
 * で、それぞれ書き込み前に検証する。ルールと行は1つの単位(SAVEPOINT)で書き込み、途中で失敗したらどちらも残さない。
 * 取引先をPL科目以外の行に設定できないトリガー・生成済み仕訳がある場合の物理削除禁止トリガー等、
 * DBルックアップを要する制約はDDL側(docs/schema/recurring_transactions.sql)に委ね、違反時はsql.jsの例外が
 * そのまま呼び出し元に伝播する。開始日は省略すると今日になり、終了日・間隔・土日の調整・金額の初期値の既定値は
 * DDLに従う(終了なし・1回ごと・調整なし・固定、計画Issue #164)。
 */
export class SqlJsRecurringTransactionRuleRepository implements RecurringTransactionRuleRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateRecurringTransactionRuleInput): RecurringTransactionRule {
    assertValidRecurringSchedule(input)
    this.assertValidLines(input.lines)

    return this.inSavepoint(() => {
      this.db.run(
        `INSERT INTO recurring_transaction_rules
          (name, bookkeeper_household_member_id, frequency,
           day_of_week, day_of_month, week_of_month, month_of_year, max_occurrences,
           starts_on, ends_on, interval, weekend_adjustment, amount_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.name,
          input.bookkeeperHouseholdMemberId ?? null,
          input.frequency,
          input.dayOfWeek ?? null,
          input.dayOfMonth ?? null,
          input.weekOfMonth ?? null,
          input.monthOfYear ?? null,
          input.maxOccurrences ?? null,
          input.startsOn ?? todayIso(),
          input.endsOn ?? null,
          input.interval ?? 1,
          input.weekendAdjustment ?? 'none',
          input.amountMode ?? 'fixed',
        ],
      )
      const id = lastInsertRowId(this.db)
      this.insertLines(id, input.lines)
      return this.findById(id)!
    })
  }

  findById(id: number): RecurringTransactionRule | null {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules WHERE id = ?', [id])
    if (!result) return null
    return mapRowToRule(result.columns, result.values[0], this.findLines(id))
  }

  findAll(): RecurringTransactionRule[] {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules ORDER BY id')
    if (!result) return []
    return result.values.map((values) => {
      const id = values[result.columns.indexOf('id')] as number
      return mapRowToRule(result.columns, values, this.findLines(id))
    })
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
    this.assertValidLines(input.lines)

    return this.inSavepoint(() => {
      this.db.run(
        `UPDATE recurring_transaction_rules SET
          name = ?, bookkeeper_household_member_id = ?, frequency = ?,
          day_of_week = ?, day_of_month = ?, week_of_month = ?, month_of_year = ?, max_occurrences = ?,
          starts_on = ?, ends_on = ?, interval = ?, weekend_adjustment = ?, amount_mode = ?
         WHERE id = ?`,
        [
          input.name,
          input.bookkeeperHouseholdMemberId ?? null,
          input.frequency,
          input.dayOfWeek ?? null,
          input.dayOfMonth ?? null,
          input.weekOfMonth ?? null,
          input.monthOfYear ?? null,
          input.maxOccurrences ?? null,
          input.startsOn ?? current.startsOn,
          input.endsOn === undefined ? current.endsOn : input.endsOn,
          input.interval ?? current.interval,
          input.weekendAdjustment ?? current.weekendAdjustment,
          input.amountMode ?? current.amountMode,
          id,
        ],
      )
      this.db.run('DELETE FROM recurring_transaction_rule_lines WHERE rule_id = ?', [id])
      this.insertLines(id, input.lines)
      return this.findById(id)!
    })
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

  findLastConfirmedLines(id: number): LastConfirmedLine[] {
    const [latest] = this.db.exec(
      `SELECT id FROM journal_entries
       WHERE generated_from_rule_id = ?
       ORDER BY recurring_due_date DESC LIMIT 1`,
      [id],
    )
    if (!latest) return []
    const [lines] = this.db.exec(
      'SELECT account_id, side, amount FROM journal_lines WHERE journal_entry_id = ? ORDER BY id',
      [latest.values[0][0] as number],
    )
    if (!lines) return []
    return lines.values.map((row) => ({
      accountId: row[0] as number,
      side: row[1] as JournalLineSide,
      amount: row[2] as number,
    }))
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

  /**
   * ルールの行の検証。貸借の一致と2行以上は仕訳と同じ検証(assertJournalBalance)を使い回す。
   * 精算バッチはシステム管理の立替金・未払金の科目の行にだけ設定できる(journal_linesと同じ検証)。
   * 取引先をPL科目以外の行に設定できないことは、DDLのTRIGGERが強制する
   */
  private assertValidLines(lines: readonly RecurringTransactionRuleLineInput[]): void {
    assertJournalBalance(lines)
    for (const line of lines) {
      if (line.settlementBatchId === undefined || line.settlementBatchId === null) continue
      const [result] = this.db.exec('SELECT category, is_system_managed FROM accounts WHERE id = ?', [line.accountId])
      const row = result?.values[0]
      if (!row) continue
      if (!isSettlementBatchTaggableAccount({ category: row[0] as AccountCategory, isSystemManaged: row[1] === 1 })) {
        throw new SettlementBatchOnNonAdvanceAccountError(line.accountId)
      }
    }
  }

  private insertLines(ruleId: number, lines: readonly RecurringTransactionRuleLineInput[]): void {
    lines.forEach((line, index) => {
      this.db.run(
        `INSERT INTO recurring_transaction_rule_lines
          (rule_id, line_no, side, account_id, amount, project_id, household_member_id, counterparty_id, settlement_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ruleId,
          index + 1,
          line.side,
          line.accountId,
          line.amount,
          line.projectId ?? null,
          line.householdMemberId ?? null,
          line.counterpartyId ?? null,
          line.settlementBatchId ?? null,
        ],
      )
    })
  }

  private findLines(ruleId: number): RecurringTransactionRuleLine[] {
    const [result] = this.db.exec(
      'SELECT * FROM recurring_transaction_rule_lines WHERE rule_id = ? ORDER BY line_no',
      [ruleId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToLine(result.columns, values))
  }

  /** ルールと行を1つの単位で書き込む(途中で失敗したら、ルールも行も残さない)。入れ子の呼び出しにも対応する */
  private inSavepoint<T>(write: () => T): T {
    this.db.run('SAVEPOINT recurring_rule_write')
    try {
      const result = write()
      this.db.run('RELEASE recurring_rule_write')
      return result
    } catch (error) {
      this.db.run('ROLLBACK TO recurring_rule_write')
      this.db.run('RELEASE recurring_rule_write')
      throw error
    }
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

function mapRowToLine(columns: string[], values: unknown[]): RecurringTransactionRuleLine {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    lineNo: get<number>('line_no'),
    side: get<JournalLineSide>('side'),
    accountId: get<number>('account_id'),
    amount: get<number>('amount'),
    projectId: get<number | null>('project_id'),
    householdMemberId: get<number | null>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    settlementBatchId: get<number | null>('settlement_batch_id'),
  }
}

function mapRowToRule(
  columns: string[],
  values: unknown[],
  lines: RecurringTransactionRuleLine[],
): RecurringTransactionRule {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    bookkeeperHouseholdMemberId: get<number | null>('bookkeeper_household_member_id'),
    lines,
    frequency: get<RecurringTransactionFrequency>('frequency'),
    dayOfWeek: get<number | null>('day_of_week'),
    dayOfMonth: get<number | null>('day_of_month'),
    weekOfMonth: get<number | null>('week_of_month'),
    monthOfYear: get<number | null>('month_of_year'),
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
