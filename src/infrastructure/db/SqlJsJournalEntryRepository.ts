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
import type {
  CreateJournalEntryLinkInput,
  JournalEntryLink,
  JournalEntryLinkType,
} from '../../domain/journal/JournalEntryLink'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { assertJournalBalance } from '../../domain/journal/assertJournalBalance'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'
import { SqlJsExternalTransactionRefRepository } from './SqlJsExternalTransactionRefRepository'

const RECONCILABLE_POSTING_WHITELIST: readonly JournalEntrySourceType[] = [
  'external_import',
  'initial_balance',
  'balance_adjustment',
]

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
    const sourceType = input.sourceType ?? 'manual'
    this.assertNoRestrictedAccountPosting(input.lines, sourceType)

    this.db.run('BEGIN')
    try {
      this.db.run(
        `INSERT INTO journal_entries (entry_date, memo, currency, source_type)
         VALUES (?, ?, ?, ?)`,
        [input.entryDate, input.memo ?? null, input.currency ?? 'JPY', sourceType],
      )
      const entryId = lastInsertRowId(this.db)
      insertLines(this.db, entryId, input.lines)

      for (const link of input.links ?? []) {
        if (link.linkType === 'settles') {
          this.assertSettlementTagMatch({
            fromEntryId: entryId,
            toEntryId: link.toEntryId,
            linkType: link.linkType,
            amount: link.amount,
          })
        }
        this.db.run(
          `INSERT INTO journal_entry_links (from_entry_id, to_entry_id, link_type, amount)
           VALUES (?, ?, ?, ?)`,
          [entryId, link.toEntryId, link.linkType, link.amount],
        )
      }

      if (input.externalTransactionRef) {
        // 単一INSERTのみでBEGIN/COMMITを持たないため、この既存トランザクションへ安全に合流する
        // (docs/domain/statement-import.md 1.5 手順7の同一トランザクション書き込み要件)。
        new SqlJsExternalTransactionRefRepository(this.db).create({
          ...input.externalTransactionRef,
          journalEntryId: entryId,
        })
      }

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
    this.assertNoRestrictedAccountPosting(input.lines, current.sourceType)

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

  createLink(input: CreateJournalEntryLinkInput): JournalEntryLink {
    if (input.linkType === 'settles') {
      this.assertSettlementTagMatch(input)
    }

    this.db.run('BEGIN')
    try {
      this.db.run(
        `INSERT INTO journal_entry_links (from_entry_id, to_entry_id, link_type, amount)
         VALUES (?, ?, ?, ?)`,
        [input.fromEntryId, input.toEntryId, input.linkType, input.amount],
      )
      const link = this.findLinkById(lastInsertRowId(this.db))!
      this.db.run('COMMIT')
      return link
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  listLinksForEntry(entryId: number): JournalEntryLink[] {
    const [result] = this.db.exec(
      'SELECT * FROM journal_entry_links WHERE from_entry_id = ? OR to_entry_id = ? ORDER BY id',
      [entryId, entryId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToJournalEntryLink(result.columns, values))
  }

  private findLinkById(id: number): JournalEntryLink | null {
    const [result] = this.db.exec('SELECT * FROM journal_entry_links WHERE id = ?', [id])
    if (!result) return null
    return mapRowToJournalEntryLink(result.columns, result.values[0])
  }

  /**
   * settlesリンク作成時のハード検証(docs/domain/settlement.md 1.8)。
   * to_entry側の一時勘定行(is_reconcilable=falseのasset/liability科目を使う行)それぞれについて、
   * from_entry側に同じaccount_id/project_id/household_member_idを持ちamountがリンクのamount以上の
   * 行が存在するかを確認する。
   */
  private assertSettlementTagMatch(input: CreateJournalEntryLinkInput): void {
    const [toResult] = this.db.exec(
      `SELECT jl.account_id, jl.project_id, jl.household_member_id
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_entry_id = ?
         AND a.category IN ('asset', 'liability')
         AND a.is_reconcilable = 0`,
      [input.toEntryId],
    )
    const toCandidates = toResult
      ? toResult.values.map((values) => ({
          accountId: values[0] as number,
          projectId: values[1] as number | null,
          householdMemberId: values[2] as number | null,
        }))
      : []

    const [fromResult] = this.db.exec(
      `SELECT account_id, project_id, household_member_id, amount
       FROM journal_lines WHERE journal_entry_id = ?`,
      [input.fromEntryId],
    )
    const fromLines = fromResult
      ? fromResult.values.map((values) => ({
          accountId: values[0] as number,
          projectId: values[1] as number | null,
          householdMemberId: values[2] as number | null,
          amount: values[3] as number,
        }))
      : []

    const hasMatch = toCandidates.some((candidate) =>
      fromLines.some(
        (line) =>
          line.accountId === candidate.accountId &&
          line.projectId === candidate.projectId &&
          line.householdMemberId === candidate.householdMemberId &&
          line.amount >= input.amount,
      ),
    )

    if (!hasMatch) {
      throw new SettlementTagMismatchError(input.fromEntryId, input.toEntryId)
    }
  }

  private assertNoRestrictedAccountPosting(
    lines: readonly JournalLineInput[],
    sourceType: JournalEntrySourceType,
  ): void {
    if (RECONCILABLE_POSTING_WHITELIST.includes(sourceType)) return

    for (const line of lines) {
      const [result] = this.db.exec('SELECT is_reconcilable FROM accounts WHERE id = ?', [
        line.accountId,
      ])
      const isReconcilable = result?.values[0]?.[0]
      if (isReconcilable === 1) {
        throw new RestrictedAccountPostingError(line.accountId, sourceType)
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

function mapRowToJournalEntryLink(columns: string[], values: unknown[]): JournalEntryLink {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    fromEntryId: get<number>('from_entry_id'),
    toEntryId: get<number>('to_entry_id'),
    linkType: get<JournalEntryLinkType>('link_type'),
    amount: get<number>('amount'),
    createdAt: get<string>('created_at'),
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
