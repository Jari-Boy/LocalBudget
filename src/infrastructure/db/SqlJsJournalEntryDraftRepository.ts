import type { Database } from 'sql.js'
import type { JournalEntry, JournalLineSide } from '../../domain/journal/JournalEntry'
import type {
  CreateJournalEntryDraftInput,
  JournalEntryDraft,
  JournalEntryDraftLine,
  JournalEntryDraftLineInput,
  JournalEntryDraftPurpose,
  UpdateJournalEntryDraftInput,
} from '../../domain/journal/JournalEntryDraft'
import type { JournalEntryDraftRepository } from '../../domain/journal/JournalEntryDraftRepository'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'

/**
 * JournalEntryDraftRepository(ドメイン層のポート)のsql.js実装。
 * journal_entries/journal_linesとは異なりバランス検証・必須項目チェックを一切課さず、
 * 入力途中の状態(未選択のaccount_id・side・amount等)をそのまま保存する
 * (docs/domain/journal.md 3章)。confirmはJournalEntryRepository.createを経由し、
 * 通常のバランス検証・is_reconcilable記帳制限を受けさせる。createが失敗した場合は
 * 下書きを削除せず残す。
 */
export class SqlJsJournalEntryDraftRepository implements JournalEntryDraftRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateJournalEntryDraftInput): JournalEntryDraft {
    this.db.run('BEGIN')
    try {
      this.db.run(
        `INSERT INTO journal_entry_drafts (purpose, entry_date, memo, currency)
         VALUES (?, ?, ?, ?)`,
        [
          input.purpose ?? 'manual_entry',
          input.entryDate ?? null,
          input.memo ?? null,
          input.currency ?? null,
        ],
      )
      const draftId = lastInsertRowId(this.db)
      insertDraftLines(this.db, draftId, input.lines ?? [])
      this.db.run('COMMIT')
      return this.findById(draftId)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  findById(id: number): JournalEntryDraft | null {
    const [headerResult] = this.db.exec('SELECT * FROM journal_entry_drafts WHERE id = ?', [id])
    if (!headerResult) return null

    const draft = mapRowToJournalEntryDraft(headerResult.columns, headerResult.values[0])
    draft.lines = this.findLinesByDraftId(id)
    return draft
  }

  findAll(): JournalEntryDraft[] {
    const [headerResult] = this.db.exec('SELECT * FROM journal_entry_drafts ORDER BY id')
    if (!headerResult) return []

    return headerResult.values.map((values) => {
      const draft = mapRowToJournalEntryDraft(headerResult.columns, values)
      draft.lines = this.findLinesByDraftId(draft.id)
      return draft
    })
  }

  update(id: number, input: UpdateJournalEntryDraftInput): JournalEntryDraft {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`journal entry draft not found: ${id}`)
    }

    this.db.run('BEGIN')
    try {
      this.db.run(
        `UPDATE journal_entry_drafts SET entry_date = ?, memo = ?, currency = ? WHERE id = ?`,
        [
          input.entryDate === undefined ? current.entryDate : input.entryDate,
          input.memo === undefined ? current.memo : input.memo,
          input.currency === undefined ? current.currency : input.currency,
          id,
        ],
      )
      if (input.lines !== undefined) {
        this.db.run('DELETE FROM journal_entry_draft_lines WHERE journal_entry_draft_id = ?', [
          id,
        ])
        insertDraftLines(this.db, id, input.lines)
      }
      this.db.run('COMMIT')
      return this.findById(id)!
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  delete(id: number): void {
    this.db.run('DELETE FROM journal_entry_drafts WHERE id = ?', [id])
  }

  confirm(id: number, journalEntryRepository: JournalEntryRepository): JournalEntry {
    const draft = this.findById(id)
    if (!draft) {
      throw new Error(`journal entry draft not found: ${id}`)
    }

    const created = journalEntryRepository.create({
      entryDate: draft.entryDate as string,
      memo: draft.memo,
      currency: draft.currency ?? undefined,
      lines: draft.lines.map((line) => ({
        accountId: line.accountId as number,
        projectId: line.projectId,
        householdMemberId: line.householdMemberId,
        counterpartyId: line.counterpartyId,
        side: line.side as JournalLineSide,
        amount: line.amount as number,
      })),
    })

    this.delete(id)
    return created
  }

  private findLinesByDraftId(draftId: number): JournalEntryDraftLine[] {
    const [result] = this.db.exec(
      'SELECT * FROM journal_entry_draft_lines WHERE journal_entry_draft_id = ? ORDER BY id',
      [draftId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToJournalEntryDraftLine(result.columns, values))
  }
}

function insertDraftLines(
  db: Database,
  draftId: number,
  lines: readonly JournalEntryDraftLineInput[],
): void {
  for (const line of lines) {
    db.run(
      `INSERT INTO journal_entry_draft_lines
        (journal_entry_draft_id, account_id, project_id, household_member_id, counterparty_id, side, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        draftId,
        line.accountId ?? null,
        line.projectId ?? null,
        line.householdMemberId ?? null,
        line.counterpartyId ?? null,
        line.side ?? null,
        line.amount ?? null,
      ],
    )
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToJournalEntryDraft(columns: string[], values: unknown[]): JournalEntryDraft {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    purpose: get<JournalEntryDraftPurpose>('purpose'),
    entryDate: get<string | null>('entry_date'),
    memo: get<string | null>('memo'),
    currency: get<string | null>('currency'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
    lines: [],
  }
}

function mapRowToJournalEntryDraftLine(
  columns: string[],
  values: unknown[],
): JournalEntryDraftLine {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    journalEntryDraftId: get<number>('journal_entry_draft_id'),
    accountId: get<number | null>('account_id'),
    projectId: get<number | null>('project_id'),
    householdMemberId: get<number | null>('household_member_id'),
    counterpartyId: get<number | null>('counterparty_id'),
    side: get<JournalLineSide | null>('side'),
    amount: get<number | null>('amount'),
    createdAt: get<string>('created_at'),
  }
}
