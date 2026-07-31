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
    assertJournalBalance(input.lines)

    this.db.run('BEGIN')
    try {
      this.db.run(
        `INSERT INTO journal_entries (entry_date, memo, currency, source_type)
         VALUES (?, ?, ?, ?)`,
        [
          input.entryDate,
          input.memo ?? null,
          input.currency ?? 'JPY',
          input.sourceType ?? 'manual',
        ],
      )
      const entryId = lastInsertRowId(this.db)
      insertLines(this.db, entryId, input.lines)
      this.db.run('COMMIT')
      return this.findById(entryId)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
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

    this.db.run('BEGIN')
    try {
      this.db.run(`UPDATE journal_entries SET entry_date = ?, memo = ? WHERE id = ?`, [
        input.entryDate,
        input.memo ?? null,
        id,
      ])
      this.db.run('DELETE FROM journal_lines WHERE journal_entry_id = ?', [id])
      insertLines(this.db, id, input.lines)
      this.db.run('COMMIT')
      return this.findById(id)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  delete(id: number): void {
    this.db.run('DELETE FROM journal_entries WHERE id = ?', [id])
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

function insertLines(db: Database, entryId: number, lines: readonly JournalLineInput[]): void {
  for (const line of lines) {
    db.run(
      `INSERT INTO journal_lines
        (journal_entry_id, account_id, project_id, household_member_id, counterparty_id, side, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entryId,
        line.accountId,
        line.projectId ?? null,
        line.householdMemberId ?? null,
        line.counterpartyId ?? null,
        line.side,
        line.amount,
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
    currency: get<string>('currency'),
    sourceType: get<JournalEntrySourceType>('source_type'),
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
    householdMemberId: get<number | null>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    side: get<JournalLineSide>('side'),
    amount: get<number>('amount'),
    createdAt: get<string>('created_at'),
  }
}
