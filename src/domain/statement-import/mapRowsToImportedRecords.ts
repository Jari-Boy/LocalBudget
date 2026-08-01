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
  const headerRow = definition.headerRowCount > 0 ? (rows[definition.headerRowCount - 1] ?? []) : null
  const dataRows = rows.slice(definition.headerRowCount)

  const dateIndex = resolveColumnIndex('dateColumn', definition.dateColumn, headerRow)
  const descriptionIndex = resolveColumnIndex(
    'descriptionColumn',
    definition.descriptionColumn,
    headerRow,
  )
  const balanceIndex =
    definition.balanceColumn == null
      ? null
      : resolveColumnIndex('balanceColumn', definition.balanceColumn, headerRow)
  const externalIdIndex =
    definition.externalIdColumn == null
      ? null
      : resolveColumnIndex('externalIdColumn', definition.externalIdColumn, headerRow)

  const amountIndex =
    definition.amountMode === 'single_signed'
      ? resolveColumnIndex('amountColumn', definition.amountColumn!, headerRow)
      : null
  const debitIndex =
    definition.amountMode === 'debit_credit_split'
      ? resolveColumnIndex('debitColumn', definition.debitColumn!, headerRow)
      : null
  const creditIndex =
    definition.amountMode === 'debit_credit_split'
      ? resolveColumnIndex('creditColumn', definition.creditColumn!, headerRow)
      : null

  return dataRows.map((row) => ({
    entryDate: parseDateWithFormat(row[dateIndex], definition.dateFormat),
    description: row[descriptionIndex]?.trim() ?? '',
    amount:
      amountIndex !== null
        ? parseAmountCell(row[amountIndex])
        : parseAmountCell(row[creditIndex!]) - parseAmountCell(row[debitIndex!]),
    balanceAfter: balanceIndex === null ? null : parseAmountCell(row[balanceIndex]),
    externalId: externalIdIndex === null ? null : (row[externalIdIndex]?.trim() || null),
    isSettled: definition.isSettled,
  }))
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
    throw new Error(`invalid amount cell: "${raw}"`)
  }
  return Math.trunc(value)
}

const DATE_TOKEN_PATTERN = /YYYY|MM|DD|M|D/g

function parseDateWithFormat(raw: string | undefined, format: string): string {
  if (raw === undefined) {
    throw new Error(`date cell is missing for format "${format}"`)
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
    throw new Error(`date "${raw}" does not match format "${format}"`)
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
