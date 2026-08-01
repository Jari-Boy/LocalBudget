import type { Database } from 'sql.js'
import type {
  CreateImportMappingDefinitionInput,
  ImportMappingDefinition,
  UpdateImportMappingDefinitionInput,
} from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'

/**
 * ImportMappingDefinitionRepository(ドメイン層のポート)のsql.js実装。
 * amount_modeとcolumn指定の整合性はDDL側のCHECK制約(docs/schema/statement_import.sql)で
 * 強制されるため、ここでは制約違反時にsql.jsの例外がそのまま呼び出し元に伝播する
 * (docs/domain/statement-import.md 2章参照)。
 */
export class SqlJsImportMappingDefinitionRepository implements ImportMappingDefinitionRepository {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  create(input: CreateImportMappingDefinitionInput): ImportMappingDefinition {
    this.db.run(
      `INSERT INTO import_mapping_definitions
         (account_id, format_group_id, is_settled, label, encoding, delimiter, header_row_count,
          date_column, date_format, description_column, amount_mode,
          amount_column, debit_column, credit_column, balance_column, external_id_column)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.accountId ?? null,
        input.formatGroupId,
        boolToSql(input.isSettled ?? null),
        input.label,
        input.encoding ?? 'utf-8',
        input.delimiter ?? ',',
        input.headerRowCount ?? 1,
        input.dateColumn,
        input.dateFormat,
        input.descriptionColumn,
        input.amountMode,
        input.amountColumn ?? null,
        input.debitColumn ?? null,
        input.creditColumn ?? null,
        input.balanceColumn ?? null,
        input.externalIdColumn ?? null,
      ],
    )
    return this.findById(lastInsertRowId(this.db))!
  }

  findById(id: number): ImportMappingDefinition | null {
    const [result] = this.db.exec('SELECT * FROM import_mapping_definitions WHERE id = ?', [id])
    if (!result) return null
    return mapRowToImportMappingDefinition(result.columns, result.values[0])
  }

  findAll(): ImportMappingDefinition[] {
    const [result] = this.db.exec('SELECT * FROM import_mapping_definitions ORDER BY id')
    if (!result) return []
    return result.values.map((values) => mapRowToImportMappingDefinition(result.columns, values))
  }

  update(id: number, input: UpdateImportMappingDefinitionInput): ImportMappingDefinition {
    const current = this.findById(id)
    if (!current) {
      throw new Error(`import mapping definition not found: ${id}`)
    }

    const next: ImportMappingDefinition = {
      ...current,
      accountId: input.accountId === undefined ? current.accountId : input.accountId,
      formatGroupId: input.formatGroupId ?? current.formatGroupId,
      isSettled: input.isSettled === undefined ? current.isSettled : input.isSettled,
      label: input.label ?? current.label,
      encoding: input.encoding ?? current.encoding,
      delimiter: input.delimiter ?? current.delimiter,
      headerRowCount: input.headerRowCount ?? current.headerRowCount,
      dateColumn: input.dateColumn ?? current.dateColumn,
      dateFormat: input.dateFormat ?? current.dateFormat,
      descriptionColumn: input.descriptionColumn ?? current.descriptionColumn,
      amountMode: input.amountMode ?? current.amountMode,
      amountColumn: input.amountColumn === undefined ? current.amountColumn : input.amountColumn,
      debitColumn: input.debitColumn === undefined ? current.debitColumn : input.debitColumn,
      creditColumn: input.creditColumn === undefined ? current.creditColumn : input.creditColumn,
      balanceColumn: input.balanceColumn === undefined ? current.balanceColumn : input.balanceColumn,
      externalIdColumn:
        input.externalIdColumn === undefined ? current.externalIdColumn : input.externalIdColumn,
    }

    this.db.run(
      `UPDATE import_mapping_definitions
       SET account_id = ?, format_group_id = ?, is_settled = ?, label = ?, encoding = ?,
           delimiter = ?, header_row_count = ?, date_column = ?, date_format = ?,
           description_column = ?, amount_mode = ?, amount_column = ?, debit_column = ?,
           credit_column = ?, balance_column = ?, external_id_column = ?
       WHERE id = ?`,
      [
        next.accountId,
        next.formatGroupId,
        boolToSql(next.isSettled),
        next.label,
        next.encoding,
        next.delimiter,
        next.headerRowCount,
        next.dateColumn,
        next.dateFormat,
        next.descriptionColumn,
        next.amountMode,
        next.amountColumn,
        next.debitColumn,
        next.creditColumn,
        next.balanceColumn,
        next.externalIdColumn,
        id,
      ],
    )
    return this.findById(id)!
  }

  delete(id: number): void {
    this.db.run('DELETE FROM import_mapping_definitions WHERE id = ?', [id])
  }

  findAvailableForAccount(accountId: number): ImportMappingDefinition[] {
    const [result] = this.db.exec(
      'SELECT * FROM import_mapping_definitions WHERE account_id = ? OR account_id IS NULL ORDER BY id',
      [accountId],
    )
    if (!result) return []
    return result.values.map((values) => mapRowToImportMappingDefinition(result.columns, values))
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

function mapRowToImportMappingDefinition(
  columns: string[],
  values: unknown[],
): ImportMappingDefinition {
  const get = <T,>(name: string): T => values[columns.indexOf(name)] as T
  return {
    id: get<number>('id'),
    accountId: get<number | null>('account_id'),
    formatGroupId: get<string>('format_group_id'),
    isSettled: sqlToBool(get<number | null>('is_settled')),
    label: get<string>('label'),
    encoding: get<string>('encoding'),
    delimiter: get<string>('delimiter'),
    headerRowCount: get<number>('header_row_count'),
    dateColumn: get<string>('date_column'),
    dateFormat: get<string>('date_format'),
    descriptionColumn: get<string>('description_column'),
    amountMode: get<ImportMappingDefinition['amountMode']>('amount_mode'),
    amountColumn: get<string | null>('amount_column'),
    debitColumn: get<string | null>('debit_column'),
    creditColumn: get<string | null>('credit_column'),
    balanceColumn: get<string | null>('balance_column'),
    externalIdColumn: get<string | null>('external_id_column'),
    createdAt: get<string>('created_at'),
    updatedAt: get<string>('updated_at'),
  }
}
