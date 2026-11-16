import type { Database } from 'sql.js'
import type {
  Counterparty,
  CounterpartyPattern,
  CreateCounterpartyInput,
  UpdateCounterpartyInput,
} from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'

/**
 * CounterpartyRepository(ドメイン層のポート)のsql.js実装。
 * 紐づく仕訳明細が存在する取引先の物理削除禁止トリガー等のドメインルールはDDL側の制約/トリガー
 * (docs/schema/counterparties.sql)で強制されるため、ここでは制約違反時にsql.jsの例外がそのまま
 * 呼び出し元に伝播する(docs/domain/counterparties.md参照)。
 */
export class SqlJsCounterpartyRepository implements CounterpartyRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateCounterpartyInput): Counterparty {
    this.db.run(
      `INSERT INTO counterparties (name, default_account_id, counterparty_group_id, sort_order)
       VALUES (?, ?, ?, ?)`,
      [
        input.name,
        input.defaultAccountId ?? null,
        input.counterpartyGroupId ?? null,
        input.sortOrder ?? 0,
      ],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): Counterparty | null {
    const [result] = this.db.exec('SELECT * FROM counterparties WHERE id = ?', [id])
    if (!result) return null
    return mapRowToCounterparty(result.columns, result.values[0])
  }

  findAll(): Counterparty[] {
    const [result] = this.db.exec('SELECT * FROM counterparties ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToCounterparty(result.columns, values))
  }

  update(id: number, input: UpdateCounterpartyInput): Counterparty {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`counterparty not found: ${id}`)
    }

    const defaultAccountId =
      input.defaultAccountId === undefined ? current.defaultAccountId : input.defaultAccountId
    this.db.run(
      `UPDATE counterparties
       SET name = ?, default_account_id = ?, counterparty_group_id = ?, sort_order = ? WHERE id = ?`,
      [
        input.name ?? current.name,
        defaultAccountId,
        input.counterpartyGroupId === undefined
          ? current.counterpartyGroupId
          : input.counterpartyGroupId,
        input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
        id,
      ],
    )
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM counterparties WHERE id = ?', [id])
  }

  deactivate(id: number): Counterparty {
    this.db.run('UPDATE counterparties SET is_active = 0 WHERE id = ?', [id])
    return this.findById(id)!
  }

  activate(id: number): Counterparty {
    this.db.run('UPDATE counterparties SET is_active = 1 WHERE id = ?', [id])
    return this.findById(id)!
  }

  addPattern(counterpartyId: number, pattern: string): CounterpartyPattern {
    this.db.run('INSERT INTO keyword_rules (counterparty_id, pattern) VALUES (?, ?)', [
      counterpartyId,
      pattern,
    ])
    return this.findPatternById(lastInsertRowId(this.db))!
  }

  findPatternsByCounterparty(counterpartyId: number): CounterpartyPattern[] {
    const [result] = this.db.exec(
      'SELECT * FROM keyword_rules WHERE counterparty_id = ? ORDER BY id',
      [counterpartyId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToCounterpartyPattern(result.columns, values))
  }

  updatePattern(patternId: number, pattern: string): CounterpartyPattern {
    this.db.run('UPDATE keyword_rules SET pattern = ? WHERE id = ?', [pattern, patternId])
    return this.findPatternById(patternId)!
  }

  deletePattern(patternId: number): void {
    this.db.run('DELETE FROM keyword_rules WHERE id = ?', [patternId])
  }

  merge(targetId: number, sourceIds: number[]): void {
    this.db.run('BEGIN')
    try {
      const target = this.findById(targetId)
      if (!target) {
        throw new Error(`counterparty not found: ${targetId}`)
      }

      for (const sourceId of sourceIds) {
        const source = this.findById(sourceId)
        if (!source) {
          throw new Error(`counterparty not found: ${sourceId}`)
        }

        const lineCount = this.countRows('journal_lines', 'counterparty_id', sourceId)
        const patternCount = this.countRows('keyword_rules', 'counterparty_id', sourceId)

        this.db.run('UPDATE journal_lines SET counterparty_id = ? WHERE counterparty_id = ?', [
          targetId,
          sourceId,
        ])
        this.db.run(
          'UPDATE keyword_rules SET counterparty_id = ? WHERE counterparty_id = ?',
          [targetId, sourceId],
        )
        // 付け替えで、統合先と同じキーワード・同じ科目になったルールは1件にまとめる(最初のものを残す)
        this.db.run(
          `DELETE FROM keyword_rules
           WHERE counterparty_id = ?
             AND id NOT IN (
               SELECT MIN(id) FROM keyword_rules WHERE counterparty_id = ?
               GROUP BY pattern, COALESCE(account_id, 0))`,
          [targetId, targetId],
        )
        this.db.run(
          `INSERT INTO counterparty_merge_log
             (target_counterparty_id, target_counterparty_name,
              source_counterparty_id, source_counterparty_name,
              line_count, pattern_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [targetId, target.name, sourceId, source.name, lineCount, patternCount],
        )
      }

      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  private findPatternById(id: number): CounterpartyPattern | null {
    const [result] = this.db.exec('SELECT * FROM keyword_rules WHERE id = ?', [id])
    if (!result) return null
    return mapRowToCounterpartyPattern(result.columns, result.values[0])
  }

  private countRows(table: string, column: string, value: number): number {
    const [result] = this.db.exec(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`, [
      value,
    ])
    return result!.values[0][0] as number
  }
}

function sqlToBool(value: number): boolean {
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToCounterparty(columns: string[], values: unknown[]): Counterparty {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    defaultAccountId: get<number | null>('default_account_id'),
    counterpartyGroupId: get<number | null>('counterparty_group_id'),
    sortOrder: get<number>('sort_order'),
    isActive: sqlToBool(get<number>('is_active')),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}

function mapRowToCounterpartyPattern(columns: string[], values: unknown[]): CounterpartyPattern {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    counterpartyId: get<number>('counterparty_id'),
    pattern: get<string>('pattern'),
    createdAt: get<string>('created_at'),
  }
}
