import type { Database } from 'sql.js'

/**
 * 操作履歴の「操作の詳細」(計画Issue #295)。履歴の一覧と「戻す範囲」パネルに、どの仕訳をどう変えたか
 * (作成・編集・削除、前後の値、科目名)を出すための記録。第1段階は仕訳(journal_entries・journal_lines)だけ。
 * 他の表へ広げるときは、DETAIL_ROW_JSONに表を足し、buildOperationDetailに相当する組み立てを加える。
 *
 * 取消用のSQLとは別に、トリガーが書き込みの前後の行をJSONで一時表へ残し、操作の確定時にここで要約する。
 * 要約したあとは、行ごとのJSONは捨てる(メモリに持つのは、先頭の数件の仕訳と、件数・科目の集計だけ)。
 * 科目名はトリガーが書き込みの瞬間に引く。科目統合のように、あとで元の科目が消える操作でも、統合前の名前が残る。
 */

/** 詳細に載せる仕訳の件数の上限。超えた分は件数(entryTotal)だけを持つ */
export const DETAIL_ENTRY_LIMIT = 5

export interface LineSnapshot {
  side: 'debit' | 'credit'
  accountName: string
  amount: number
}

export interface EntrySnapshot {
  date: string
  memo: string | null
  comment: string | null
  lines: LineSnapshot[]
}

export interface EntryChange {
  kind: 'created' | 'updated' | 'deleted'
  entryId: number
  /** 操作の前の内容(作成では null) */
  before: EntrySnapshot | null
  /** 操作のあとの内容(削除では null) */
  after: EntrySnapshot | null
}

export interface AccountUsage {
  name: string
  /** その科目の明細行を持つ仕訳の件数 */
  count: number
}

export interface OperationDetail {
  /** 変更した仕訳の全件数 */
  entryTotal: number
  /** 先頭の数件(DETAIL_ENTRY_LIMIT件まで。仕訳のid順) */
  entries: EntryChange[]
  /** 変更した仕訳が使った科目と、その仕訳の件数(多い順) */
  accountUsage: AccountUsage[]
}

/** CSV取込の確定に添える情報(取込画面が確定時に渡す) */
export interface StatementImportMeta {
  kind: 'statementImport'
  /** 金融機関名(取込の定義の金融機関) */
  institution: string | null
  /** 取込先の科目の名前 */
  targetAccountName: string
  /** 取り込んだファイルと、そのファイルから確定した件数 */
  files: Array<{ name: string; count: number }>
}

export type OperationMeta = StatementImportMeta

/** トリガーが残した、書き込み1行分の前後の値 */
export interface RowRecord {
  table: string
  rowId: number
  /** 書き込みの前の行(INSERTでは null) */
  before: string | null
  /** 書き込みのあとの行(DELETEでは null) */
  after: string | null
}

/**
 * 前後の値をトリガーが残す表と、その行をJSONにするSQL式(rowは OLD または NEW)。
 * 科目名は、書き込みの瞬間にaccountsから引く。
 */
export const DETAIL_ROW_JSON: Partial<Record<string, (row: 'OLD' | 'NEW') => string>> = {
  journal_entries: (row) =>
    `json_object('entry_date', ${row}.entry_date, 'memo', ${row}.memo, 'comment', ${row}.comment)`,
  journal_lines: (row) =>
    `json_object('journal_entry_id', ${row}.journal_entry_id, 'side', ${row}.side, 'amount', ${row}.amount, ` +
    `'account_name', (SELECT name FROM accounts WHERE id = ${row}.account_id))`,
}

interface EntryRow {
  entry_date: string
  memo: string | null
  comment: string | null
}

interface LineRow {
  journal_entry_id: number
  side: 'debit' | 'credit'
  amount: number
  account_name: string
}

function parse<T>(json: string | null): T | null {
  return json === null ? null : (JSON.parse(json) as T)
}

function snapshotOf(header: EntryRow, lines: LineSnapshot[]): EntrySnapshot {
  return { date: header.entry_date, memo: header.memo, comment: header.comment, lines }
}

function sameSnapshot(a: EntrySnapshot, b: EntrySnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 1つの操作の記録(行ごとの前後の値)から、どの仕訳がどう変わったかを組み立てる。仕訳に触れていなければundefined。
 * 各行の「操作の前」は、その行に最初に起きた書き込みの前の値(最初がINSERTなら、操作の前には無かった行)。
 * 「操作のあと」は、組み立てる時点のDBの内容(操作の確定の直後に呼ぶ)。
 */
export function buildOperationDetail(db: Database, records: readonly RowRecord[]): OperationDetail | undefined {
  const originalEntries = new Map<number, EntryRow | null>()
  const originalLines = new Map<number, LineRow | null>()
  const entryOfLine = new Map<number, number>()

  for (const record of records) {
    if (record.table === 'journal_entries') {
      if (!originalEntries.has(record.rowId)) originalEntries.set(record.rowId, parse<EntryRow>(record.before))
    } else if (record.table === 'journal_lines') {
      if (!originalLines.has(record.rowId)) originalLines.set(record.rowId, parse<LineRow>(record.before))
      const row = parse<LineRow>(record.before) ?? parse<LineRow>(record.after)
      if (row) entryOfLine.set(record.rowId, row.journal_entry_id)
    }
  }

  const affected = new Set<number>([...originalEntries.keys(), ...entryOfLine.values()])
  if (affected.size === 0) return undefined

  const headerStatement = db.prepare('SELECT entry_date, memo, comment FROM journal_entries WHERE id = ?')
  const linesStatement = db.prepare(
    `SELECT l.id AS id, l.side AS side, l.amount AS amount, a.name AS account_name
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = ? ORDER BY l.id`,
  )
  const changes: EntryChange[] = []
  const usage = new Map<string, number>()
  try {
    for (const entryId of [...affected].sort((a, b) => a - b)) {
      headerStatement.bind([entryId])
      const finalHeader = headerStatement.step() ? (headerStatement.getAsObject() as unknown as EntryRow) : null
      headerStatement.reset()

      linesStatement.bind([entryId])
      const finalLines: Array<LineSnapshot & { id: number }> = []
      while (linesStatement.step()) {
        const row = linesStatement.getAsObject() as unknown as { id: number } & Omit<LineRow, 'journal_entry_id'>
        finalLines.push({ id: row.id, side: row.side, accountName: row.account_name, amount: row.amount })
      }
      linesStatement.reset()

      // 操作の前: この操作で触れていない明細行はそのまま、触れた明細行は最初の書き込みの前の値
      const originalHeader = originalEntries.has(entryId) ? originalEntries.get(entryId)! : finalHeader
      const lineSnapshots = new Map<number, LineSnapshot>()
      for (const line of finalLines) {
        if (!originalLines.has(line.id)) lineSnapshots.set(line.id, { side: line.side, accountName: line.accountName, amount: line.amount })
      }
      for (const [lineId, original] of originalLines) {
        if (original !== null && original.journal_entry_id === entryId) {
          lineSnapshots.set(lineId, { side: original.side, accountName: original.account_name, amount: original.amount })
        }
      }
      const beforeLines = [...lineSnapshots.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line)

      const before = originalHeader ? snapshotOf(originalHeader, beforeLines) : null
      const after = finalHeader
        ? snapshotOf(finalHeader, finalLines.map(({ side, accountName, amount }) => ({ side, accountName, amount })))
        : null

      if (before === null && after === null) continue
      let kind: EntryChange['kind']
      if (before === null) kind = 'created'
      else if (after === null) kind = 'deleted'
      else if (sameSnapshot(before, after)) continue
      else kind = 'updated'

      changes.push({ kind, entryId, before, after })
      const used = new Set((after ?? before)!.lines.map((line) => line.accountName))
      for (const name of used) usage.set(name, (usage.get(name) ?? 0) + 1)
    }
  } finally {
    headerStatement.free()
    linesStatement.free()
  }

  if (changes.length === 0) return undefined
  return {
    entryTotal: changes.length,
    entries: changes.slice(0, DETAIL_ENTRY_LIMIT),
    accountUsage: [...usage.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}
