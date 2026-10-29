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
import { JournalEntryLinkLineError } from '../../domain/journal/JournalEntryLinkLineError'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'
import { SqlJsExternalTransactionRefRepository } from './SqlJsExternalTransactionRefRepository'

const RECONCILABLE_POSTING_WHITELIST: readonly JournalEntrySourceType[] = [
  'external_import',
  'initial_balance',
  'balance_adjustment',
]

/**
 * リンク(journal_entry_links)の取得用SELECT。DBにはfrom_line_id/to_line_idしか無いため、
 * 仕訳単位のトラバーサル(findLinkedEntries等)で使うfrom_entry_id/to_entry_idは
 * journal_linesとのJOINで導出する(計画Issue #132)。
 */
const LINK_SELECT = `SELECT l.id, l.from_line_id, l.to_line_id,
       fl.journal_entry_id AS from_entry_id, tl.journal_entry_id AS to_entry_id,
       l.link_type, l.amount, l.created_at
  FROM journal_entry_links l
  JOIN journal_lines fl ON fl.id = l.from_line_id
  JOIN journal_lines tl ON tl.id = l.to_line_id`

/** リンクの検証(assertLinkLinesCompatible)に必要な、明細行と科目の属性 */
interface LinkLine {
  entryId: number
  accountId: number
  side: JournalLineSide
  amount: number
  householdMemberId: number | null
  counterpartyId: number | null
  projectId: number | null
  category: string
  isReconcilable: number | null
}

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
        `INSERT INTO journal_entries
          (entry_date, memo, currency, source_type, household_member_id, generated_from_rule_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.entryDate,
          input.memo ?? null,
          input.currency ?? 'JPY',
          sourceType,
          input.householdMemberId,
          input.generatedFromRuleId ?? null,
        ],
      )
      const entryId = lastInsertRowId(this.db)
      const lineIds = insertLines(this.db, entryId, input.lines)

      for (const link of input.links ?? []) {
        const fromLineId = lineIds[link.fromLineIndex]
        if (fromLineId === undefined) {
          throw new JournalEntryLinkLineError('line_not_found', null, link.toLineId)
        }
        this.insertValidatedLink({
          fromLineId,
          toLineId: link.toLineId,
          linkType: link.linkType,
          amount: link.amount,
        })
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
    assertLineIdsBelongToEntry(input.lines, current)

    this.db.run('BEGIN')
    try {
      this.db.run(`UPDATE journal_entries SET entry_date = ?, memo = ? WHERE id = ?`, [
        input.entryDate,
        input.memo ?? null,
        id,
      ])
      applyLineDiff(this.db, current, input.lines)
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

  deleteByProjectId(projectId: number): void {
    this.db.run('BEGIN')
    try {
      this.db.run(
        `DELETE FROM journal_entries WHERE id IN (
           SELECT DISTINCT journal_entry_id FROM journal_lines WHERE project_id = ?
         )`,
        [projectId],
      )
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  createLink(input: CreateJournalEntryLinkInput): JournalEntryLink {
    this.db.run('BEGIN')
    try {
      const linkId = this.insertValidatedLink(input)
      const link = this.findLinkById(linkId)!
      this.db.run('COMMIT')
      return link
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  listLinksForEntry(entryId: number): JournalEntryLink[] {
    const [result] = this.db.exec(
      `${LINK_SELECT} WHERE fl.journal_entry_id = ? OR tl.journal_entry_id = ? ORDER BY l.id`,
      [entryId, entryId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToJournalEntryLink(result.columns, values))
  }

  private findLinkById(id: number): JournalEntryLink | null {
    const [result] = this.db.exec(`${LINK_SELECT} WHERE l.id = ?`, [id])
    if (!result) return null
    return mapRowToJournalEntryLink(result.columns, result.values[0])
  }

  /**
   * リンクを検証してから書き込み、採番されたidを返す。呼び出し側のトランザクション内で
   * 実行されることを前提とする(createは仕訳・明細と同一トランザクション、createLinkは
   * 単独のトランザクション)。検証に失敗した場合は何も書き込まずにドメインエラーをスローする。
   */
  private insertValidatedLink(input: CreateJournalEntryLinkInput): number {
    this.assertLinkLinesCompatible(input)
    this.db.run(
      `INSERT INTO journal_entry_links (from_line_id, to_line_id, link_type, amount)
       VALUES (?, ?, ?, ?)`,
      [input.fromLineId, input.toLineId, input.linkType, input.amount],
    )
    return lastInsertRowId(this.db)
  }

  /**
   * リンク作成時のハード検証(docs/domain/journal.md 1.8、docs/domain/settlement.md 1.8、計画Issue #132)。
   * 両リンク種別に共通して、from_line・to_lineが存在し、科目が一致し、貸借が逆であり、
   * from_lineから出るリンクの金額合計(既存分+今回分)がfrom_lineの金額を超えないことを確認する。
   * settlesリンクはさらに、消込先が一時勘定(is_reconcilable = falseの資産・負債)であり、
   * household_member_id・counterparty_id・project_idが一致することを確認する。allocatesリンクは
   * 費用を別の世帯メンバー・取引先へ付け替える関係のため、タグの一致は求めない。
   * to_lineに対する消込の累計が元の金額を超える過剰消込は、従来通りここでは検証しない
   * (docs/domain/settlement.md 1.6)。
   */
  private assertLinkLinesCompatible(input: CreateJournalEntryLinkInput): void {
    const from = this.findLinkLine(input.fromLineId)
    const to = this.findLinkLine(input.toLineId)
    if (from === null || to === null) {
      throw new JournalEntryLinkLineError('line_not_found', input.fromLineId, input.toLineId)
    }

    const isSettles = input.linkType === 'settles'
    const raiseMismatch = (reason: 'account_mismatch' | 'side_not_opposite'): never => {
      if (isSettles) throw new SettlementTagMismatchError(from.entryId, to.entryId)
      throw new JournalEntryLinkLineError(reason, input.fromLineId, input.toLineId)
    }

    if (from.accountId !== to.accountId) raiseMismatch('account_mismatch')
    if (from.side === to.side) raiseMismatch('side_not_opposite')

    if (isSettles) {
      const isTemporaryAccount =
        (to.category === 'asset' || to.category === 'liability') && to.isReconcilable === 0
      const hasSameTags =
        from.householdMemberId === to.householdMemberId &&
        from.counterpartyId === to.counterpartyId &&
        from.projectId === to.projectId
      if (!isTemporaryAccount || !hasSameTags) {
        throw new SettlementTagMismatchError(from.entryId, to.entryId)
      }
    }

    const [sumResult] = this.db.exec(
      'SELECT COALESCE(SUM(amount), 0) FROM journal_entry_links WHERE from_line_id = ?',
      [input.fromLineId],
    )
    const alreadyLinked = sumResult.values[0][0] as number
    if (alreadyLinked + input.amount > from.amount) {
      throw new JournalEntryLinkLineError('amount_exceeds_from_line', input.fromLineId, input.toLineId)
    }
  }

  private findLinkLine(lineId: number): LinkLine | null {
    const [result] = this.db.exec(
      `SELECT jl.journal_entry_id, jl.account_id, jl.side, jl.amount,
              jl.household_member_id, jl.counterparty_id, jl.project_id,
              a.category, a.is_reconcilable
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.id = ?`,
      [lineId],
    )
    if (!result) return null
    const row = result.values[0]
    return {
      entryId: row[0] as number,
      accountId: row[1] as number,
      side: row[2] as JournalLineSide,
      amount: row[3] as number,
      householdMemberId: row[4] as number | null,
      counterpartyId: row[5] as number | null,
      projectId: row[6] as number | null,
      category: row[7] as string,
      isReconcilable: row[8] as number | null,
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

/** 明細行を順に挿入し、採番された行idを入力と同じ順序で返す(linksのfromLineIndexの解決に使う) */
function insertLines(db: Database, entryId: number, lines: readonly JournalLineInput[]): number[] {
  return lines.map((line) => insertLine(db, entryId, line))
}

function insertLine(db: Database, entryId: number, line: JournalLineInput): number {
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
 * 仕訳明細の差分更新(計画Issue #132)。入力に含まれない既存行はDELETE(行に紐づく
 * journal_entry_linksもON DELETE CASCADEで一緒に削除される)、idを持つ行は同じidのまま
 * UPDATE、idを持たない行はINSERTする。全削除→再挿入にしないのは、行idが変わると
 * 行単位のリンクが失われてしまうため。
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
       SET account_id = ?, project_id = ?, household_member_id = ?, counterparty_id = ?, side = ?, amount = ?
       WHERE id = ?`,
      [
        line.accountId,
        line.projectId ?? null,
        line.householdMemberId ?? null,
        line.counterpartyId ?? null,
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
    currency: get<string>('currency'),
    sourceType: get<JournalEntrySourceType>('source_type'),
    householdMemberId: get<number>('household_member_id'),
    generatedFromRuleId: get<number | null>('generated_from_rule_id'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
    lines: [],
  }
}

function mapRowToJournalEntryLink(columns: string[], values: unknown[]): JournalEntryLink {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    fromLineId: get<number>('from_line_id'),
    toLineId: get<number>('to_line_id'),
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
