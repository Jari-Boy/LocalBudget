import type { Database } from 'sql.js'
import type {
  CreateExternalTransactionRefInput,
  ExternalTransactionRef,
} from '../../domain/reconciliation/ExternalTransactionRef'
import type { ExternalTransactionRefRepository } from '../../domain/reconciliation/ExternalTransactionRefRepository'

/**
 * ExternalTransactionRefRepository(ドメイン層のポート)のsql.js実装。
 * create()は単一INSERT文のみで構成し、明示的なBEGIN/COMMITでラップしない。これにより、
 * StatementImportドメインの取込確定フローがJournalEntryRepository.create()の既存トランザクション
 * 内からこのRepositoryのINSERTを呼び出しても、ネストしたBEGINにならず安全に合流できる
 * (docs/domain/statement-import.md 1.5 手順7の同一トランザクション書き込み要件)。
 * 同一account_id×external_idはDDL側のUNIQUE制約(docs/schema/reconciliation.sql)で強制されるため、
 * ここでは制約違反時のsql.js例外がそのまま呼び出し元に伝播する。
 */
export class SqlJsExternalTransactionRefRepository implements ExternalTransactionRefRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateExternalTransactionRefInput): ExternalTransactionRef {
    this.db.run(
      `INSERT INTO external_transaction_refs
         (account_id, journal_entry_id, external_id, entry_date, description, amount,
          external_balance_after, is_settled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.accountId,
        input.journalEntryId,
        input.externalId,
        input.entryDate,
        input.description,
        input.amount,
        input.externalBalanceAfter ?? null,
        boolToSql(input.isSettled ?? null),
      ],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): ExternalTransactionRef | null {
    const [result] = this.db.exec('SELECT * FROM external_transaction_refs WHERE id = ?', [id])
    if (!result) return null
    return mapRowToExternalTransactionRef(result.columns, result.values[0])
  }

  findByAccountAndExternalId(accountId: number, externalId: string): ExternalTransactionRef | null {
    const [result] = this.db.exec(
      'SELECT * FROM external_transaction_refs WHERE account_id = ? AND external_id = ?',
      [accountId, externalId],
    )
    if (!result) return null
    return mapRowToExternalTransactionRef(result.columns, result.values[0])
  }

  findByAccount(accountId: number): ExternalTransactionRef[] {
    const [result] = this.db.exec(
      'SELECT * FROM external_transaction_refs WHERE account_id = ?',
      [accountId],
    )
    if (!result) return []
    return result.values.map((row) => mapRowToExternalTransactionRef(result.columns, row))
  }
}

function boolToSql(value: boolean | null): number | null {
  if (value === null) return null
  return value ? 1 : 0
}

function sqlToBool(value: number | null): boolean | null {
  if (value === null) return null
  return value !== 0
}

function lastInsertRowId(db: Database): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function mapRowToExternalTransactionRef(
  columns: string[],
  values: unknown[],
): ExternalTransactionRef {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    accountId: get<number>('account_id'),
    journalEntryId: get<number>('journal_entry_id'),
    externalId: get<string>('external_id'),
    entryDate: get<string>('entry_date'),
    description: get<string>('description'),
    amount: get<number>('amount'),
    externalBalanceAfter: get<number | null>('external_balance_after'),
    isSettled: sqlToBool(get<number | null>('is_settled')),
    importedAt: get<string>('imported_at'),
  }
}
