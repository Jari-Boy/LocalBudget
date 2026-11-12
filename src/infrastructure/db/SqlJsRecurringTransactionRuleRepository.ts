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
  RecurringScheduleRound,
  RecurringTransactionRuleLineInput,
  UpdateRecurringTransactionRuleInput,
  WeekendAdjustment,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { LastConfirmedLine } from '../../domain/recurring-transaction/resolveLastConfirmedLines'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'
import { assertValidAmountSchedule } from '../../domain/recurring-transaction/recurringAmountSchedule'
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
    const { lines, schedule } = this.resolveLinesAndSchedule(input)

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
      this.insertLines(id, lines)
      this.insertSchedule(id, schedule)
      return this.findById(id)!
    })
  }

  findById(id: number): RecurringTransactionRule | null {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules WHERE id = ?', [id])
    if (!result) return null
    return mapRowToRule(result.columns, result.values[0], this.findLines(id), this.findSchedule(id))
  }

  findAll(): RecurringTransactionRule[] {
    const [result] = this.db.exec('SELECT * FROM recurring_transaction_rules ORDER BY id')
    if (!result) return []
    return result.values.map((values) => {
      const id = values[result.columns.indexOf('id')] as number
      return mapRowToRule(result.columns, values, this.findLines(id), this.findSchedule(id))
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
    const { lines, schedule } = this.resolveLinesAndSchedule(input)
    this.assertConfirmedRoundsUnchanged(current, schedule)

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
      this.db.run('DELETE FROM recurring_transaction_rule_amounts WHERE rule_id = ?', [id])
      this.insertLines(id, lines)
      this.insertSchedule(id, schedule)
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
   * ルールの行と金額表の検証(書き込み前)。固定・前回確定額のルールは、貸借の一致と2行以上を仕訳と同じ検証
   * (assertJournalBalance)で行い、行の金額は正の整数でなければならない。金額表のルールは、表が必須で
   * (回の連続・全行の金額・各回の貸借の一致はassertValidAmountSchedule)、行の金額は1回目の金額に
   * 置き換えて保存する(行は2行以上)。金額表でないルールに表は付けられない。精算バッチはシステム管理の
   * 立替金・未払金の科目の行にだけ設定できる(journal_linesと同じ検証)。取引先をPL科目以外の行に設定
   * できないことは、DDLのTRIGGERが強制する。保存する行(金額表のルールは1回目の金額を反映)と表を返す
   */
  private resolveLinesAndSchedule(input: CreateRecurringTransactionRuleInput): {
    lines: RecurringTransactionRuleLineInput[]
    schedule: RecurringScheduleRound[]
  } {
    const schedule = input.schedule ?? []
    let lines = input.lines
    if ((input.amountMode ?? 'fixed') === 'schedule') {
      if (lines.length < 2) {
        throw new InvalidRecurringScheduleError(`rule must have at least 2 lines: got ${lines.length}`)
      }
      assertValidAmountSchedule(
        lines.map((l, index) => ({ lineNo: index + 1, side: l.side })),
        schedule,
      )
      const first = new Map(schedule[0].amounts.map((a) => [a.lineNo, a.amount]))
      lines = lines.map((l, index) => ({ ...l, amount: first.get(index + 1) ?? l.amount }))
    } else {
      if (schedule.length > 0) {
        throw new InvalidRecurringScheduleError('amount schedule can only be set when amountMode is schedule')
      }
      assertJournalBalance(lines)
      if (lines.some((l) => !Number.isInteger(l.amount) || l.amount <= 0)) {
        throw new InvalidRecurringScheduleError('rule line amounts must be positive integers')
      }
    }
    this.assertSettlementBatchLines(lines)
    return { lines, schedule }
  }

  private assertSettlementBatchLines(lines: readonly RecurringTransactionRuleLineInput[]): void {
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

  /**
   * 確定済みの回(生成済みの件数まで)の金額は編集できない(計画Issue #180)。金額表のルールで、生成済みの
   * 件数がn件なら、新しい表は1〜n回目が今の表と同じで、n回より短くできない。未確定の回は編集でき、回数も変えられる
   */
  private assertConfirmedRoundsUnchanged(current: RecurringTransactionRule, next: readonly RecurringScheduleRound[]): void {
    if (current.amountMode !== 'schedule') return
    const generated = this.countGeneratedJournalEntries(current.id)
    if (generated === 0) return
    const confirmed = current.schedule.slice(0, generated)
    const sameConfirmed =
      next.length >= confirmed.length && confirmed.every((entry, index) => JSON.stringify(entry) === JSON.stringify(next[index]))
    if (!sameConfirmed) {
      throw new InvalidRecurringScheduleError(
        `the first ${generated} rounds are already confirmed and cannot be changed or removed`,
      )
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

  private insertSchedule(ruleId: number, schedule: readonly RecurringScheduleRound[]): void {
    for (const entry of schedule) {
      for (const { lineNo, amount } of entry.amounts) {
        this.db.run(
          'INSERT INTO recurring_transaction_rule_amounts (rule_id, round, line_no, amount) VALUES (?, ?, ?, ?)',
          [ruleId, entry.round, lineNo, amount],
        )
      }
    }
  }

  private findSchedule(ruleId: number): RecurringScheduleRound[] {
    const [result] = this.db.exec(
      'SELECT round, line_no, amount FROM recurring_transaction_rule_amounts WHERE rule_id = ? ORDER BY round, line_no',
      [ruleId],
    )
    if (!result) return []
    const rounds: RecurringScheduleRound[] = []
    for (const [round, lineNo, amount] of result.values as [number, number, number][]) {
      const last = rounds[rounds.length - 1]
      if (last !== undefined && last.round === round) last.amounts.push({ lineNo, amount })
      else rounds.push({ round, amounts: [{ lineNo, amount }] })
    }
    return rounds
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
  schedule: RecurringScheduleRound[],
): RecurringTransactionRule {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    bookkeeperHouseholdMemberId: get<number | null>('bookkeeper_household_member_id'),
    lines,
    schedule,
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
