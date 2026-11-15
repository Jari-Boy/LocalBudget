import type { Database } from 'sql.js'

/** 履歴に保持する操作の既定の上限(計画Issue #202: 50〜100件の範囲で50件) */
export const DEFAULT_HISTORY_LIMIT = 50

/** 1つの表に対する、1操作での変更件数 */
export interface TableChange {
  table: string
  inserted: number
  updated: number
  deleted: number
}

/** 履歴の1件(取消の単位)。バッチ(グループ)は複数の書き込みを含んでも1件 */
export interface HistoryOperation {
  id: number
  /** 操作の種類(例: 'journalEntry.create')。表示名への変換はUI側が行う */
  label: string
  /** 記録した時刻(ISO 8601) */
  recordedAt: string
  changes: TableChange[]
}

export interface UndoPreview {
  /** 戻す操作。新しい順(実際に戻す順) */
  operations: HistoryOperation[]
  /** 選んだ操作より前にあり、そのまま残る操作の件数 */
  keptCount: number
}

export class OperationNotFoundError extends Error {
  readonly operationId: number

  constructor(operationId: number) {
    super(`操作履歴に操作(id=${operationId})が見つかりません。破棄されたか、すでに取り消されています`)
    this.name = 'OperationNotFoundError'
    this.operationId = operationId
  }
}

export interface OperationHistory {
  /** 書き込みを伴う呼び出しを1件の操作として記録する。書き込みがなければ残さない */
  record<T>(label: string, fn: () => T): T
  /** 以降のrecordを1件の操作にまとめ始める(バッチ操作用)。endGroupまで入れ子にしても1件 */
  beginGroup(label: string): void
  endGroup(): void
  /** 新しい順 */
  list(): HistoryOperation[]
  previewUndoTo(operationId: number): UndoPreview
  /** 選んだ操作とそれ以降を新しい順に戻す。全体で1トランザクション。戻した操作数を返す */
  undoTo(operationId: number): number
  clear(): void
}

interface StoredOperation extends HistoryOperation {
  firstSeq: number
  lastSeq: number
}

const LOG_TABLE = '__undo_log'
const CTL_TABLE = '__undo_ctl'

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** SQL文字列リテラル(トリガー本体の中で組み立てる式に埋め込む用) */
function sqlLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/**
 * 操作履歴(計画Issue #202)。DBの全表に一時(TEMP)トリガーを張り、書き込みの逆操作のSQLを
 * 一時テーブルへ自動で記録する。履歴はこの接続(Workerのメモリ)の中だけにあり、
 * db.export()(永続化・バックアップ)には含まれない。トリガー方式なので、Repositoryに依らず
 * 波及削除(ON DELETE CASCADE)や他のトリガーによる書き込みも漏れなく記録される。
 * 取消は、記録を新しい順に逆順で実行する(その間は記録を止める)。
 *
 * db.run()経由でBEGIN〜COMMITするため、withAutoSave(db.runを監視)の保存経路に乗る。
 */
export function createOperationHistory(
  db: Database,
  options: { limit?: number } = {},
): OperationHistory {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT
  const operations: StoredOperation[] = []
  let nextId = 1
  let groupDepth = 0
  let groupLabel = ''
  let groupStartSeq = 0

  installTriggers(db)

  function maxSeq(): number {
    return (db.exec(`SELECT COALESCE(MAX(seq), 0) FROM temp.${LOG_TABLE}`)[0].values[0][0] as number) ?? 0
  }

  function summarize(firstSeq: number, lastSeq: number): TableChange[] {
    const rows = db.exec(
      `SELECT tbl, op, COUNT(*) FROM temp.${LOG_TABLE} WHERE seq BETWEEN ${firstSeq} AND ${lastSeq} GROUP BY tbl, op`,
    )
    const byTable = new Map<string, TableChange>()
    for (const [tbl, op, count] of rows[0]?.values ?? []) {
      const change = byTable.get(tbl as string) ?? {
        table: tbl as string,
        inserted: 0,
        updated: 0,
        deleted: 0,
      }
      if (op === 'insert') change.inserted = count as number
      else if (op === 'update') change.updated = count as number
      else change.deleted = count as number
      byTable.set(tbl as string, change)
    }
    return [...byTable.values()]
  }

  function commitOperation(label: string, startSeq: number): void {
    const lastSeq = maxSeq()
    if (lastSeq <= startSeq) return
    operations.push({
      id: nextId++,
      label,
      recordedAt: new Date().toISOString(),
      changes: summarize(startSeq + 1, lastSeq),
      firstSeq: startSeq + 1,
      lastSeq,
    })
    while (operations.length > limit) {
      const dropped = operations.shift()!
      db.run(`DELETE FROM temp.${LOG_TABLE} WHERE seq <= ${dropped.lastSeq}`)
    }
  }

  function toPublic(operation: StoredOperation): HistoryOperation {
    const { id, label, recordedAt, changes } = operation
    return { id, label, recordedAt, changes: changes.map((c) => ({ ...c })) }
  }

  function indexOf(operationId: number): number {
    const index = operations.findIndex((o) => o.id === operationId)
    if (index < 0) throw new OperationNotFoundError(operationId)
    return index
  }

  return {
    record<T>(label: string, fn: () => T): T {
      if (groupDepth > 0) return fn()
      const startSeq = maxSeq()
      try {
        return fn()
      } finally {
        commitOperation(label, startSeq)
      }
    },

    beginGroup(label: string): void {
      if (groupDepth === 0) {
        groupLabel = label
        groupStartSeq = maxSeq()
      }
      groupDepth += 1
    },

    endGroup(): void {
      if (groupDepth === 0) return
      groupDepth -= 1
      if (groupDepth === 0) commitOperation(groupLabel, groupStartSeq)
    },

    list(): HistoryOperation[] {
      return operations.map(toPublic).reverse()
    },

    previewUndoTo(operationId: number): UndoPreview {
      const index = indexOf(operationId)
      return {
        operations: operations.slice(index).map(toPublic).reverse(),
        keptCount: index,
      }
    },

    undoTo(operationId: number): number {
      const index = indexOf(operationId)
      const target = operations[index]
      const undone = operations.length - index

      const rows = db.exec(
        `SELECT undo_sql FROM temp.${LOG_TABLE} WHERE seq >= ${target.firstSeq} ORDER BY seq DESC`,
      )
      const statements = (rows[0]?.values ?? []).map((row) => row[0] as string)

      db.run('BEGIN')
      try {
        db.run(`UPDATE temp.${CTL_TABLE} SET suppress = 1`)
        // 逆順に戻す途中は、親子関係が一時的に崩れうるため、FKの検査をCOMMITまで遅らせる
        db.run('PRAGMA defer_foreign_keys = ON')
        for (const statement of statements) db.run(statement)
        db.run(`DELETE FROM temp.${LOG_TABLE} WHERE seq >= ${target.firstSeq}`)
        db.run(`UPDATE temp.${CTL_TABLE} SET suppress = 0`)
        db.run('COMMIT')
      } catch (error) {
        db.run('ROLLBACK')
        db.run(`UPDATE temp.${CTL_TABLE} SET suppress = 0`)
        throw error
      }
      operations.splice(index)
      return undone
    },

    clear(): void {
      operations.length = 0
      db.run(`DELETE FROM temp.${LOG_TABLE}`)
    },
  }
}

/**
 * 対象の表(sqlite_内部表・履歴自身を除く全表)ごとに、INSERT/UPDATE/DELETEの一時トリガーを張る。
 * 一時トリガーは、この接続の間だけ有効で、メインDBのファイル(db.export())に書き込まれない。
 * 各トリガーは「その書き込みを打ち消すSQL」を、quote()で値を埋め込んだ文字列として記録する。
 * 行はrowidで特定する(全表がrowid表。INTEGER PRIMARY KEYはrowidの別名)。
 */
function installTriggers(db: Database): void {
  db.run(
    `CREATE TEMP TABLE IF NOT EXISTS ${LOG_TABLE} (
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       tbl TEXT NOT NULL,
       op TEXT NOT NULL,
       undo_sql TEXT NOT NULL
     )`,
  )
  db.run(`CREATE TEMP TABLE IF NOT EXISTS ${CTL_TABLE} (suppress INTEGER NOT NULL)`)
  if (!db.exec(`SELECT 1 FROM temp.${CTL_TABLE}`).length) {
    db.run(`INSERT INTO temp.${CTL_TABLE} (suppress) VALUES (0)`)
  }

  const tables = (
    db.exec(
      `SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'`,
    )[0]?.values ?? []
  ).map((row) => row[0] as string)

  for (const table of tables) {
    const columns = (db.exec(`PRAGMA main.table_info(${quoteIdent(table)})`)[0]?.values ?? []).map(
      (row) => row[1] as string,
    )
    if (columns.length === 0) continue
    const t = quoteIdent(table)
    const when = `WHEN (SELECT suppress FROM ${CTL_TABLE}) = 0`
    const log = (op: string, undoExpr: string) =>
      `INSERT INTO ${LOG_TABLE} (tbl, op, undo_sql) VALUES (${sqlLiteral(table)}, '${op}', ${undoExpr});`

    const oldValues = columns.map((c) => `quote(OLD.${quoteIdent(c)})`).join(` || ',' || `)
    const columnList = columns.map(quoteIdent).join(',')
    const setOld = columns
      .map((c) => `${sqlLiteral(`${quoteIdent(c)}=`)} || quote(OLD.${quoteIdent(c)})`)
      .join(` || ',' || `)

    const triggers: Array<[string, string, string]> = [
      [
        'ins',
        'AFTER INSERT',
        log('insert', `${sqlLiteral(`DELETE FROM ${t} WHERE rowid=`)} || NEW.rowid`),
      ],
      [
        'upd',
        'AFTER UPDATE',
        log(
          'update',
          `${sqlLiteral(`UPDATE ${t} SET `)} || ${setOld} || ${sqlLiteral(' WHERE rowid=')} || NEW.rowid`,
        ),
      ],
      [
        'del',
        'AFTER DELETE',
        log(
          'delete',
          `${sqlLiteral(`INSERT INTO ${t}(rowid,${columnList}) VALUES(`)} || OLD.rowid || ',' || ${oldValues} || ')'`,
        ),
      ],
    ]
    for (const [kind, event, body] of triggers) {
      const name = quoteIdent(`__undo_${kind}_${table}`)
      db.run(`DROP TRIGGER IF EXISTS temp.${name}`)
      db.run(`CREATE TEMP TRIGGER ${name} ${event} ON main.${t} ${when} BEGIN ${body} END`)
    }
  }
}
