import type { Database } from 'sql.js'
import type {
  CreateJournalEntryInput,
  JournalEntry,
  JournalEntrySourceType,
  JournalLine,
  JournalLineInput,
  JournalLineSide,
  UpdateJournalEntryInput,
} from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { assertJournalBalance } from '../../domain/journal/assertJournalBalance'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import type { AccountCategory } from '../../domain/account/Account'
import { AutoBalanceAdjustmentEntryReadOnlyError } from '../../domain/journal/AutoBalanceAdjustmentEntryReadOnlyError'
import {
  findAffectedAccountIdsOfEntry,
  isAutoBalanceAdjustmentEntry,
  reconcileAutoBalanceAdjustments,
} from './autoBalanceAdjustment'
import { ExpenseSplitSourceLineLockedError } from '../../domain/journal/ExpenseSplitSourceLineLockedError'
import type { ExpenseSplitSourceLink } from '../../domain/expense-splitting/listSplittableLineEntries'
import { SqlJsExternalTransactionRefRepository } from './SqlJsExternalTransactionRefRepository'

/**
 * JournalEntryRepository(ドメイン層のポート)のsql.js実装。
 * ヘッダーと全明細行をまとめて構築し、ひとつのDBトランザクションへの書き込み直前に
 * 貸借バランス検証(assertJournalBalance)を行う。不一致であれば書き込みを行わず
 * UnbalancedJournalEntryErrorを投げる(docs/domain/journal.md 1.3)。
 * FK制約違反等、DB側で発生したエラーによりトランザクションが失敗した場合もROLLBACKし、
 * 借方だけ・明細の一部だけといった中間状態を残さない。
 * counterparty_idのPL科目限定制約はDDL側のトリガー(docs/schema/journal.sql)で強制されるため、
 * ここでは制約違反時のsql.js例外をそのまま呼び出し元に伝播させる。
 */
export class SqlJsJournalEntryRepository implements JournalEntryRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateJournalEntryInput): JournalEntry {
    return this.createMany([input])[0]
  }

  createMany(inputs: readonly CreateJournalEntryInput[]): JournalEntry[] {
    if (inputs.length === 0) return []

    for (const input of inputs) {
      assertJournalBalance(input.lines)
      this.assertSettlementBatchOnlyOnAdvanceAccounts(input.lines)
    }

    this.db.run('BEGIN')
    try {
      const entryIds = inputs.map((input) => this.insertEntry(input))
      // 残高の基準点との食い違いを、同じトランザクションで自動調整仕訳に反映する(計画Issue #205)
      reconcileAutoBalanceAdjustments(
        this.db,
        entryIds.flatMap((entryId) => findAffectedAccountIdsOfEntry(this.db, entryId)),
      )
      this.db.run('COMMIT')
      return entryIds.map((entryId) => this.findById(entryId)!)
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  /** 仕訳1件と明細を書き込む。トランザクション(BEGIN/COMMIT)は呼び出し側が持つ */
  private insertEntry(input: CreateJournalEntryInput): number {
    const sourceType = input.sourceType ?? 'manual'
    this.db.run(
      `INSERT INTO journal_entries
        (entry_date, memo, comment, currency, source_type, household_member_id, generated_from_rule_id,
         recurring_due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.entryDate,
        input.memo ?? null,
        input.comment ?? null,
        input.currency ?? 'JPY',
        sourceType,
        input.householdMemberId,
        input.generatedFromRuleId ?? null,
        input.recurringDueDate ?? null,
      ],
    )
    const entryId = lastInsertRowId(this.db)
    insertLines(this.db, entryId, input.lines)
    for (const sourceLineId of input.expenseSplitSourceLineIds ?? []) {
      this.db.run('INSERT INTO expense_split_source_lines (split_entry_id, source_line_id) VALUES (?, ?)', [entryId, sourceLineId])
    }

    if (input.externalTransactionRef) {
      // 単一INSERTのみでBEGIN/COMMITを持たないため、この既存トランザクションへ安全に合流する
      // (docs/domain/statement-import.md 1.5 手順7の同一トランザクション書き込み要件)。
      new SqlJsExternalTransactionRefRepository(this.db).create({
        ...input.externalTransactionRef,
        journalEntryId: entryId,
      })
    }
    return entryId
  }

  findById(id: number): JournalEntry | null {
    const [headerResult] = this.db.exec('SELECT * FROM journal_entries WHERE id = ?', [id])
    if (!headerResult) return null

    const entry = mapRowToJournalEntry(headerResult.columns, headerResult.values[0])
    entry.lines = this.findLinesByEntryId(id)
    return entry
  }

  findAll(): JournalEntry[] {
    const [headerResult] = this.db.exec('SELECT * FROM journal_entries ORDER BY id')
    if (!headerResult) return []

    return headerResult.values.map((values) => {
      const entry = mapRowToJournalEntry(headerResult.columns, values)
      entry.lines = this.findLinesByEntryId(entry.id)
      return entry
    })
  }

  update(id: number, input: UpdateJournalEntryInput): JournalEntry {
    assertJournalBalance(input.lines)

    const current = this.findById(id)
    if (!current) {
      throw new Error(`journal entry not found: ${id}`)
    }
    if (current.sourceType === 'auto_balance_adjustment') {
      throw new AutoBalanceAdjustmentEntryReadOnlyError(id)
    }
    this.assertSettlementBatchOnlyOnAdvanceAccounts(input.lines)
    assertLineIdsBelongToEntry(input.lines, current)
    this.assertSourceLinesUnchanged(current, input.lines)

    this.db.run('BEGIN')
    try {
      this.db.run(
        `UPDATE journal_entries SET entry_date = ?, memo = ?, comment = ?, household_member_id = ? WHERE id = ?`,
        [
          input.entryDate,
          input.memo ?? null,
          input.comment === undefined ? current.comment : input.comment,
          input.householdMemberId === undefined ? current.householdMemberId : input.householdMemberId,
          id,
        ],
      )
      applyLineDiff(this.db, current, input.lines)
      // 更新前後で触れた科目の自動調整仕訳を計算し直す(計画Issue #205)
      reconcileAutoBalanceAdjustments(this.db, [
        ...current.lines.map((line) => line.accountId),
        ...findAffectedAccountIdsOfEntry(this.db, id),
      ])
      this.db.run('COMMIT')
      return this.findById(id)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  delete(id: number): void {
    if (isAutoBalanceAdjustmentEntry(this.db, id)) {
      throw new AutoBalanceAdjustmentEntryReadOnlyError(id)
    }
    const lockedLineIds = this.findLockedSourceLineIds(id)
    if (lockedLineIds.length > 0) throw new ExpenseSplitSourceLineLockedError(lockedLineIds)
    this.db.run('BEGIN')
    try {
      const affected = findAffectedAccountIdsOfEntry(this.db, id)
      this.db.run('DELETE FROM journal_entries WHERE id = ?', [id])
      reconcileAutoBalanceAdjustments(this.db, affected)
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  findExpenseSplitSourceLinks(): ExpenseSplitSourceLink[] {
    const [result] = this.db.exec(
      'SELECT split_entry_id, source_line_id FROM expense_split_source_lines ORDER BY split_entry_id, source_line_id',
    )
    return (result?.values ?? []).map((row) => ({ splitEntryId: row[0] as number, sourceLineId: row[1] as number }))
  }

  /** 仕訳の明細行のうち、割勘対象行の記録がある(割勘済みの)行のid */
  private findLockedSourceLineIds(entryId: number): number[] {
    const [result] = this.db.exec(
      `SELECT DISTINCT l.id FROM journal_lines l
       JOIN expense_split_source_lines s ON s.source_line_id = l.id
       WHERE l.journal_entry_id = ?`,
      [entryId],
    )
    return (result?.values ?? []).map((row) => row[0] as number)
  }

  /** 割勘済みの行を、削除したり、金額・科目・貸借を変えたりする更新を拒否する(計画Issue #271) */
  private assertSourceLinesUnchanged(current: JournalEntry, lines: readonly JournalLineInput[]): void {
    const locked = new Set(this.findLockedSourceLineIds(current.id))
    if (locked.size === 0) return
    const violated = current.lines
      .filter((existing) => locked.has(existing.id))
      .filter((existing) => {
        const next = lines.find((l) => l.id === existing.id)
        return next === undefined || next.accountId !== existing.accountId || next.side !== existing.side || next.amount !== existing.amount
      })
      .map((existing) => existing.id)
    if (violated.length > 0) throw new ExpenseSplitSourceLineLockedError(violated)
  }

  deleteBySettlementBatchId(settlementBatchId: number): void {
    this.db.run('BEGIN')
    try {
      const [entries] = this.db.exec(
        'SELECT DISTINCT journal_entry_id FROM journal_lines WHERE settlement_batch_id = ?',
        [settlementBatchId],
      )
      const entryIds = (entries?.values ?? []).map((row) => row[0] as number)
      const affected = entryIds.flatMap((entryId) => findAffectedAccountIdsOfEntry(this.db, entryId))
      this.db.run(
        `DELETE FROM journal_entries WHERE id IN (
           SELECT DISTINCT journal_entry_id FROM journal_lines WHERE settlement_batch_id = ?
         )`,
        [settlementBatchId],
      )
      reconcileAutoBalanceAdjustments(this.db, affected)
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  /**
   * 精算バッチのタグは割勘の一時勘定(システム管理の立替金・未払金)の行にのみ設定できる
   * (計画Issue #144・#167、docs/domain/settlement.md)。科目区分に依存するためDDLでは表現しづらく、
   * Repository層で書き込み前に検証する。
   */
  private assertSettlementBatchOnlyOnAdvanceAccounts(lines: readonly JournalLineInput[]): void {
    for (const line of lines) {
      if (line.settlementBatchId === undefined || line.settlementBatchId === null) continue
      const [result] = this.db.exec('SELECT category, is_system_managed FROM accounts WHERE id = ?', [
        line.accountId,
      ])
      const row = result?.values[0]
      if (!row) continue
      if (!isSettlementBatchTaggableAccount({ category: row[0] as AccountCategory, isSystemManaged: row[1] === 1 })) {
        throw new SettlementBatchOnNonAdvanceAccountError(line.accountId)
      }
    }
  }

  private findLinesByEntryId(entryId: number): JournalLine[] {
    const [result] = this.db.exec(
      'SELECT * FROM journal_lines WHERE journal_entry_id = ? ORDER BY id',
      [entryId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToJournalLine(result.columns, values))
  }
}

/** 明細行を順に挿入し、採番された行idを入力と同じ順序で返す(linksのfromLineIndexの解決に使う) */
function insertLines(db: Database, entryId: number, lines: readonly JournalLineInput[]): number[] {
  return lines.map((line) => insertLine(db, entryId, line))
}

function insertLine(db: Database, entryId: number, line: JournalLineInput): number {
  db.run(
    `INSERT INTO journal_lines
      (journal_entry_id, account_id, project_id, household_member_id, counterparty_id, settlement_batch_id, side, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entryId,
      line.accountId,
      line.projectId ?? null,
      line.householdMemberId,
      line.counterpartyId ?? null,
      line.settlementBatchId ?? null,
      line.side,
      line.amount,
    ],
  )
  return lastInsertRowId(db)
}

/**
 * updateに渡された行idが、更新対象の仕訳自身の明細に属し、かつ重複していないことを確認する
 * (計画Issue #132)。他の仕訳の明細idを指定すると、その仕訳の明細を意図せず書き換えて
 * しまうため、書き込み前に拒否する。
 */
function assertLineIdsBelongToEntry(lines: readonly JournalLineInput[], current: JournalEntry): void {
  const ownLineIds = new Set(current.lines.map((line) => line.id))
  const seen = new Set<number>()
  for (const line of lines) {
    if (line.id === undefined) continue
    if (!ownLineIds.has(line.id)) {
      throw new Error(`journal line ${line.id} does not belong to journal entry ${current.id}`)
    }
    if (seen.has(line.id)) {
      throw new Error(`journal line ${line.id} is specified more than once`)
    }
    seen.add(line.id)
  }
}

/**
 * 仕訳明細の差分更新(計画Issue #132)。入力に含まれない既存行はDELETE、idを持つ行は
 * 同じidのままUPDATE、idを持たない行はINSERTする。
 */
function applyLineDiff(db: Database, current: JournalEntry, lines: readonly JournalLineInput[]): void {
  const keptIds = new Set(lines.flatMap((line) => (line.id === undefined ? [] : [line.id])))
  for (const existing of current.lines) {
    if (!keptIds.has(existing.id)) {
      db.run('DELETE FROM journal_lines WHERE id = ?', [existing.id])
    }
  }

  for (const line of lines) {
    if (line.id === undefined) {
      insertLine(db, current.id, line)
      continue
    }
    db.run(
      `UPDATE journal_lines
       SET account_id = ?, project_id = ?, household_member_id = ?, counterparty_id = ?,
           settlement_batch_id = ?, side = ?, amount = ?
       WHERE id = ?`,
      [
        line.accountId,
        line.projectId ?? null,
        line.householdMemberId,
        line.counterpartyId ?? null,
        line.settlementBatchId ?? null,
        line.side,
        line.amount,
        line.id,
      ],
    )
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToJournalEntry(columns: string[], values: unknown[]): JournalEntry {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    entryDate: get<string>('entry_date'),
    memo: get<string | null>('memo'),
    comment: get<string | null>('comment'),
    currency: get<string>('currency'),
    sourceType: get<JournalEntrySourceType>('source_type'),
    householdMemberId: get<number>('household_member_id'),
    generatedFromRuleId: get<number | null>('generated_from_rule_id'),
    recurringDueDate: get<string | null>('recurring_due_date'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
    lines: [],
  }
}

function mapRowToJournalLine(columns: string[], values: unknown[]): JournalLine {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    journalEntryId: get<number>('journal_entry_id'),
    accountId: get<number>('account_id'),
    projectId: get<number | null>('project_id'),
    householdMemberId: get<number>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    settlementBatchId: get<number | null>('settlement_batch_id'),
    side: get<JournalLineSide>('side'),
    amount: get<number>('amount'),
    createdAt: get<string>('created_at'),
  }
}
