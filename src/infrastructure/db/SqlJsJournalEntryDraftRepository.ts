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
 * 明細が仕訳化できる最小限の完成状態(科目・貸借・正の金額がすべて入力済み)かどうかを
 * 判定する(計画Issue #125)。JournalEntryLinesTableが各ブロックの末尾に常に空行を
 * 自動追加する挙動(行追加ボタンの廃止)により、下書きには未入力のままの明細が常に
 * 含まれるようになったため、confirm時にそれらを除外する必要がある。
 */
function isCompleteDraftLine(
  line: JournalEntryDraftLine,
): line is JournalEntryDraftLine & { accountId: number; side: JournalLineSide; amount: number } {
  return line.accountId !== null && line.side !== null && line.amount !== null && line.amount > 0
}

/**
 * JournalEntryDraftRepository(ドメイン層のポート)のsql.js実装。
 * journal_entries/journal_linesとは異なりバランス検証・必須項目チェックを一切課さず、
 * 入力途中の状態(未選択のaccount_id・side・amount等)をそのまま保存する
 * (docs/domain/journal.md 3章)。confirmはJournalEntryRepository.createを経由し、
 * 通常のバランス検証・is_reconcilable記帳制限を受けさせる。createが失敗した場合は
 * 下書きを削除せず残す。confirm時、未入力のまま残っている明細(isCompleteDraftLine)は
 * 送信対象から除外する(JournalEntryLinesTableが常に末尾へ自動追加する空行がそのまま
 * 含まれてしまうため、計画Issue #125)。
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
        `INSERT INTO journal_entry_drafts (purpose, entry_date, memo, currency, household_member_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          input.purpose ?? 'manual_entry',
          input.entryDate ?? null,
          input.memo ?? null,
          input.currency ?? null,
          input.householdMemberId ?? null,
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
        `UPDATE journal_entry_drafts
         SET entry_date = ?, memo = ?, currency = ?, household_member_id = ?
         WHERE id = ?`,
        [
          input.entryDate === undefined ? current.entryDate : input.entryDate,
          input.memo === undefined ? current.memo : input.memo,
          input.currency === undefined ? current.currency : input.currency,
          input.householdMemberId === undefined ? current.householdMemberId : input.householdMemberId,
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
      householdMemberId: draft.householdMemberId as number,
      lines: draft.lines.filter(isCompleteDraftLine).map((line) => ({
        accountId: line.accountId,
        projectId: line.projectId,
        householdMemberId: line.householdMemberId,
        counterpartyId: line.counterpartyId,
        side: line.side,
        amount: line.amount,
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
    householdMemberId: get<number | null>('household_member_id'),
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
