import type { Database } from 'sql.js'
import type {
  CreateSettlementBatchInput,
  SettlementBatch,
  SettlementBatchType,
  UpdateSettlementBatchInput,
} from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'

/**
 * SettlementBatchRepository(ドメイン層のポート)のsql.js実装。
 * typeのCHECK制約・紐づく仕訳明細が存在するバッチの物理削除禁止トリガー等のドメインルールは
 * DDL側(docs/schema/settlement_batches.sql)で強制されるため、ここでは制約違反時にsql.jsの
 * 例外がそのまま呼び出し元に伝播する(計画Issue #133)。
 */
export class SqlJsSettlementBatchRepository implements SettlementBatchRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateSettlementBatchInput): SettlementBatch {
    this.db.run('INSERT INTO settlement_batches (name, type, counterparty_id) VALUES (?, ?, ?)', [
      input.name,
      input.type,
      input.counterpartyId ?? null,
    ])
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): SettlementBatch | null {
    const [result] = this.db.exec('SELECT * FROM settlement_batches WHERE id = ?', [id])
    if (!result) return null
    return mapRowToSettlementBatch(result.columns, result.values[0])
  }

  findAll(): SettlementBatch[] {
    const [result] = this.db.exec('SELECT * FROM settlement_batches ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToSettlementBatch(result.columns, values))
  }

  update(id: number, input: UpdateSettlementBatchInput): SettlementBatch {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`settlement batch not found: ${id}`)
    }
    this.db.run('UPDATE settlement_batches SET name = ?, counterparty_id = ? WHERE id = ?', [
      input.name === undefined ? current.name : input.name,
      input.counterpartyId === undefined ? current.counterpartyId : input.counterpartyId,
      id,
    ])
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM settlement_batches WHERE id = ?', [id])
  }
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToSettlementBatch(columns: string[], values: unknown[]): SettlementBatch {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    name: get<string>('name'),
    type: get<SettlementBatchType>('type'),
    counterpartyId: get<number | null>('counterparty_id'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
