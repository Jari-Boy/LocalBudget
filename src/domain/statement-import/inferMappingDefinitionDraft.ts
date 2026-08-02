import type { AmountMode } from './ImportMappingDefinition'
import { COLUMN_KEYWORD_DICTIONARY, type MappingColumnField } from './columnKeywordDictionary'

/**
 * 列マッピングの推測結果における1つの候補列。headerNameはヘッダー行が検出できた場合のみ
 * 設定され、ヘッダー無しCSVではnullになる。
 */
export interface ColumnCandidate {
  columnIndex: number
  headerName: string | null
}

/**
 * CreateImportMappingDefinitionInput(ImportMappingDefinition.ts)相当のドラフト。
 * 各列フィールドは単一値ではなく、確信度順にランキングされた候補列の配列として表現する
 * (候補が1件なら確信度が高い推測、0件ならCSVの内容からは推測できず未設定、2件以上なら
 * 型的に複数列が該当し確定できないことを表す)。label・formatGroupId・isSettledは
 * CSVの中身から判定できないため常にnull(docs/domain/statement-import.md「目標」1.)。
 */
export interface ImportMappingDefinitionDraft {
  headerRowCount: number
  dateColumn: ColumnCandidate[]
  descriptionColumn: ColumnCandidate[]
  amountMode: AmountMode | null
  amountColumn: ColumnCandidate[]
  debitColumn: ColumnCandidate[]
  creditColumn: ColumnCandidate[]
  balanceColumn: ColumnCandidate[]
  label: null
  formatGroupId: null
  isSettled: null
}

type ColumnValueType = 'date' | 'numeric' | 'text'

const FIELD_FALLBACK_TYPE: Record<MappingColumnField, ColumnValueType> = {
  dateColumn: 'date',
  descriptionColumn: 'text',
  debitColumn: 'numeric',
  creditColumn: 'numeric',
  amountColumn: 'numeric',
  balanceColumn: 'numeric',
}

const FIELD_ORDER: MappingColumnField[] = [
  'dateColumn',
  'descriptionColumn',
  'debitColumn',
  'creditColumn',
  'amountColumn',
  'balanceColumn',
]

const DATE_LIKE_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/
const NUMERIC_LIKE_PATTERN = /^[+-]?[\d,]+(\.\d+)?$/
const TYPE_MATCH_THRESHOLD = 0.8

export function inferMappingDefinitionDraft(rows: string[][]): ImportMappingDefinitionDraft {
  const { headerRow, dataRows } = detectHeaderRow(rows)

  // 1パス目: ヘッダーキーワードが一意にマッチしたフィールドを先にすべて確定させる。
  // これにより、後段の型ベースのフォールバック候補生成(2パス目)から、既に確定済みの列を
  // フィールドの処理順によらず一貫して除外できる。
  const claimedColumns = new Set<number>()
  const headerMatches = {} as Record<MappingColumnField, ColumnCandidate[]>
  const confidentHeaderField = {} as Record<MappingColumnField, boolean>

  for (const field of FIELD_ORDER) {
    const matches = headerRow ? matchHeaderKeywords(field, headerRow) : []
    headerMatches[field] = matches
    confidentHeaderField[field] = matches.length === 1
    if (matches.length === 1) {
      claimedColumns.add(matches[0].columnIndex)
    }
  }

  // 2パス目: 未確定のフィールドを型ベースの候補ランキングで解決する。
  const resolved = {} as Record<MappingColumnField, ColumnCandidate[]>
  for (const field of FIELD_ORDER) {
    const fallbackType = FIELD_FALLBACK_TYPE[field]
    if (confidentHeaderField[field]) {
      resolved[field] = headerMatches[field]
    } else if (headerMatches[field].length > 1) {
      resolved[field] = [...headerMatches[field]].sort(
        (a, b) => typeScore(b.columnIndex, dataRows, fallbackType) - typeScore(a.columnIndex, dataRows, fallbackType),
      )
    } else {
      resolved[field] = rankColumnsByType(dataRows, fallbackType, headerRow, claimedColumns)
    }
  }

  return {
    headerRowCount: headerRow ? 1 : 0,
    dateColumn: resolved.dateColumn,
    descriptionColumn: resolved.descriptionColumn,
    amountMode: inferAmountMode(confidentHeaderField),
    amountColumn: resolved.amountColumn,
    debitColumn: resolved.debitColumn,
    creditColumn: resolved.creditColumn,
    balanceColumn: resolved.balanceColumn,
    label: null,
    formatGroupId: null,
    isSettled: null,
  }
}

function inferAmountMode(confidentHeaderField: Record<MappingColumnField, boolean>): AmountMode | null {
  if (confidentHeaderField.debitColumn && confidentHeaderField.creditColumn) return 'debit_credit_split'
  if (confidentHeaderField.amountColumn) return 'single_signed'
  return null
}

function detectHeaderRow(rows: string[][]): { headerRow: string[] | null; dataRows: string[][] } {
  if (rows.length === 0) return { headerRow: null, dataRows: [] }

  const firstRow = rows[0]
  const allKeywords = Object.values(COLUMN_KEYWORD_DICTIONARY).flat()
  const looksLikeHeader = firstRow.some((cell) =>
    allKeywords.some((keyword) => normalizeHeaderCell(cell).includes(keyword)),
  )

  return looksLikeHeader ? { headerRow: firstRow, dataRows: rows.slice(1) } : { headerRow: null, dataRows: rows }
}

function normalizeHeaderCell(cell: string): string {
  return cell.normalize('NFKC').trim()
}

function matchHeaderKeywords(field: MappingColumnField, headerRow: string[]): ColumnCandidate[] {
  const keywords = COLUMN_KEYWORD_DICTIONARY[field]
  const candidates: ColumnCandidate[] = []
  headerRow.forEach((header, columnIndex) => {
    const normalized = normalizeHeaderCell(header)
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      candidates.push({ columnIndex, headerName: header })
    }
  })
  return candidates
}

interface ColumnStats {
  dateRatio: number
  numericRatio: number
  averageLength: number
  nonEmptyCount: number
}

function computeColumnStats(columnIndex: number, dataRows: string[][]): ColumnStats {
  const values = dataRows.map((row) => row[columnIndex]?.trim() ?? '').filter((value) => value !== '')

  if (values.length === 0) {
    return { dateRatio: 0, numericRatio: 0, averageLength: 0, nonEmptyCount: 0 }
  }

  const dateMatches = values.filter((value) => DATE_LIKE_PATTERN.test(value)).length
  const numericMatches = values.filter((value) => NUMERIC_LIKE_PATTERN.test(value)).length
  const totalLength = values.reduce((sum, value) => sum + value.length, 0)

  return {
    dateRatio: dateMatches / values.length,
    numericRatio: numericMatches / values.length,
    averageLength: totalLength / values.length,
    nonEmptyCount: values.length,
  }
}

function scoreForType(stats: ColumnStats, type: ColumnValueType): number {
  if (type === 'date') return stats.dateRatio
  if (type === 'numeric') return stats.numericRatio
  return stats.averageLength
}

function typeScore(columnIndex: number, dataRows: string[][], type: ColumnValueType): number {
  return scoreForType(computeColumnStats(columnIndex, dataRows), type)
}

function matchesType(stats: ColumnStats, type: ColumnValueType): boolean {
  if (type === 'date') return stats.dateRatio >= TYPE_MATCH_THRESHOLD
  if (type === 'numeric') return stats.numericRatio >= TYPE_MATCH_THRESHOLD
  return stats.dateRatio < TYPE_MATCH_THRESHOLD && stats.numericRatio < TYPE_MATCH_THRESHOLD
}

function rankColumnsByType(
  dataRows: string[][],
  fallbackType: ColumnValueType,
  headerRow: string[] | null,
  claimedColumns: ReadonlySet<number>,
): ColumnCandidate[] {
  const columnCount = headerRow?.length ?? dataRows.reduce((max, row) => Math.max(max, row.length), 0)

  const scored: { columnIndex: number; score: number }[] = []
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    if (claimedColumns.has(columnIndex)) continue
    const stats = computeColumnStats(columnIndex, dataRows)
    if (stats.nonEmptyCount === 0) continue
    if (!matchesType(stats, fallbackType)) continue
    scored.push({ columnIndex, score: scoreForType(stats, fallbackType) })
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.map(({ columnIndex }) => ({
    columnIndex,
    headerName: headerRow ? (headerRow[columnIndex] ?? null) : null,
  }))
}
