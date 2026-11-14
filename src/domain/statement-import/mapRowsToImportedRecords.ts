import type { ImportMappingDefinition } from './ImportMappingDefinition'
import type { ImportedRecord } from './ImportedRecord'
import { MappingColumnNotFoundError } from './MappingColumnNotFoundError'

/**
 * readCsvが返した「行×列」の生データを、ImportMappingDefinitionに基づいてImportedRecord[]へ
 * 変換する(docs/domain/statement-import.md 1.4)。列の指定は数値文字列であれば0始まりの
 * 列インデックス、そうでなければヘッダー行の列名として解釈する(2.1)。headerRowCountが1以上の
 * 場合、先頭スキップ行のうち最後の行(ヘッダー・注記行の並びでは通常ヘッダー行に相当する)を
 * 列名解決に使う。headerRowCount = 0の場合は列インデックス指定のみ使用できる。
 * 取込データの列構成が定義と一致しない場合はMappingColumnNotFoundErrorを投げる。
 */
export function mapRowsToImportedRecords(
  rows: string[][],
  definition: ImportMappingDefinition,
): ImportedRecord[] {
  const columns = resolveMappingColumns(rows, definition)
  return rows.slice(definition.headerRowCount).map((row) => mapRowToImportedRecord(row, definition, columns))
}

/** 定義が指す各列の位置(0始まり)。列の解決は行ごとではなくCSV全体で一度だけ行う。 */
export interface MappingColumns {
  date: number
  description: number
  balance: number | null
  externalId: number | null
  amount: number | null
  debit: number | null
  credit: number | null
}

/** 定義の列指定をCSVの列位置に解決する。見つからない列があればMappingColumnNotFoundErrorを投げる。 */
export function resolveMappingColumns(rows: string[][], definition: ImportMappingDefinition): MappingColumns {
  const headerRow = definition.headerRowCount > 0 ? (rows[definition.headerRowCount - 1] ?? []) : null
  const optional = (fieldName: string, spec: string | null) =>
    spec == null ? null : resolveColumnIndex(fieldName, spec, headerRow)
  const split = definition.amountMode === 'debit_credit_split'
  return {
    date: resolveColumnIndex('dateColumn', definition.dateColumn, headerRow),
    description: resolveColumnIndex('descriptionColumn', definition.descriptionColumn, headerRow),
    balance: optional('balanceColumn', definition.balanceColumn),
    externalId: optional('externalIdColumn', definition.externalIdColumn),
    amount: split ? null : resolveColumnIndex('amountColumn', definition.amountColumn!, headerRow),
    debit: split ? resolveColumnIndex('debitColumn', definition.debitColumn!, headerRow) : null,
    credit: split ? resolveColumnIndex('creditColumn', definition.creditColumn!, headerRow) : null,
  }
}

/**
 * 1行をImportedRecordへ変換する。日付・金額が読み取れなければMappingCellErrorを投げる。
 * 実際の取込(mapRowsToImportedRecords)とマッピング編集画面のプレビュー(previewMappingRows)が
 * 同じ変換を共有し、結果がずれないようにするために切り出している。
 */
export function mapRowToImportedRecord(
  row: string[],
  definition: ImportMappingDefinition,
  columns: MappingColumns,
): ImportedRecord {
  return {
    entryDate: parseDateWithFormat(row[columns.date], definition.dateFormat),
    description: row[columns.description]?.trim() ?? '',
    amount:
      columns.amount !== null
        ? signedAmount(parseAmountCell(row[columns.amount]), definition.invertAmountSign)
        : parseAmountCell(row[columns.credit!]) - parseAmountCell(row[columns.debit!]),
    balanceAfter: columns.balance === null ? null : parseAmountCell(row[columns.balance]),
    externalId: columns.externalId === null ? null : (row[columns.externalId]?.trim() || null),
    isSettled: definition.isSettled,
  }
}

/**
 * 符号付き1列の金額に、定義の「符号を反転する」(計画Issue #192)を適用する。金額の符号を変える
 * 唯一の箇所で、仕訳変換層・レビュー層では反転しない。入金・出金の2列(debit_credit_split)は
 * 列の割り当てを入れ替えれば足りるため、反転の対象外。0は-0にしない。
 */
function signedAmount(value: number, invert: boolean): number {
  return invert && value !== 0 ? -value : value
}

/** 日付・金額のセルが読み取れないことを表すエラー。kindで原因を区別する。 */
export class MappingCellError extends Error {
  readonly kind: 'invalidDate' | 'invalidAmount'

  constructor(kind: 'invalidDate' | 'invalidAmount', message: string) {
    super(message)
    this.name = 'MappingCellError'
    this.kind = kind
  }
}

function resolveColumnIndex(
  fieldName: string,
  columnSpec: string,
  headerRow: string[] | null,
): number {
  if (/^\d+$/.test(columnSpec)) {
    return Number(columnSpec)
  }
  if (headerRow === null) {
    throw new MappingColumnNotFoundError(fieldName, columnSpec)
  }
  const index = headerRow.indexOf(columnSpec)
  if (index === -1) {
    throw new MappingColumnNotFoundError(fieldName, columnSpec)
  }
  return index
}

function parseAmountCell(raw: string | undefined): number {
  if (raw === undefined) return 0
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  const normalized = trimmed.replace(/,/g, '')
  const value = Number(normalized)
  if (Number.isNaN(value)) {
    throw new MappingCellError('invalidAmount', `invalid amount cell: "${raw}"`)
  }
  return Math.trunc(value)
}

const DATE_TOKEN_PATTERN = /YYYY|MM|DD|M|D/g

function parseDateWithFormat(raw: string | undefined, format: string): string {
  if (raw === undefined) {
    throw new MappingCellError('invalidDate', `date cell is missing for format "${format}"`)
  }

  const tokens = format.match(DATE_TOKEN_PATTERN)
  if (!tokens) {
    throw new Error(`unsupported date format: "${format}"`)
  }

  const escaped = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped
    .replace(/YYYY/g, '(\\d{4})')
    .replace(/MM/g, '(\\d{1,2})')
    .replace(/DD/g, '(\\d{1,2})')
    .replace(/M/g, '(\\d{1,2})')
    .replace(/D/g, '(\\d{1,2})')
  const match = raw.trim().match(new RegExp(`^${pattern}$`))
  if (!match) {
    throw new MappingCellError('invalidDate', `date "${raw}" does not match format "${format}"`)
  }

  const values: Partial<Record<'YYYY' | 'MM' | 'DD' | 'M' | 'D', string>> = {}
  tokens.forEach((token, i) => {
    values[token as 'YYYY' | 'MM' | 'DD' | 'M' | 'D'] = match[i + 1]
  })

  const year = values.YYYY!
  const month = (values.MM ?? values.M!).padStart(2, '0')
  const day = (values.DD ?? values.D!).padStart(2, '0')
  return `${year}-${month}-${day}`
}
