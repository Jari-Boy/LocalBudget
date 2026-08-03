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
 *
 * CreateImportMappingDefinitionInputが持つdateFormat・externalIdColumnは、意図的に
 * このドラフトのスコープに含めていない(実装漏れではない)。Issue #48の「列マッピングの推測」の
 * 記述はヘッダーキーワード例(日付・摘要・入金/出金・金額・残高)の範囲に留まり、日付の書式や
 * 外部取引IDの列は推測対象として言及されていないため。特に外部取引IDは金融機関ごとの表記ゆれが
 * 大きく、信頼できるキーワード辞書を用意できない。将来これらの推測が必要になった場合は、
 * 別Issueとしてスコープを検討する。
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
  // これにより、後段の候補解決(2パス目)から、既に確定済みの列をフィールドの処理順に
  // よらず一貫して除外できる。claimedColumnsは各フィールド自身の一意マッチのみから
  // 決まるため、FIELD_ORDERの並びを変えても結果は変わらない。
  const claimedColumns = new Set<number>()
  const headerMatches = {} as Record<MappingColumnField, ColumnCandidate[]>

  for (const field of FIELD_ORDER) {
    const matches = headerRow ? matchHeaderKeywords(field, headerRow) : []
    headerMatches[field] = matches
    if (matches.length === 1) {
      claimedColumns.add(matches[0].columnIndex)
    }
  }

  // 2パス目: フィールドごとに以下の優先順位で候補を解決する。
  //   1. ヘッダーキーワードが一意にマッチ → そのまま確定候補として採用
  //   2. ヘッダーキーワードが複数列にマッチ(曖昧) → 既に他フィールドが確定済みの列を除外した
  //      上で、1件に絞れれば確定候補、複数残れば型の一致度でランキング
  //      (実データ検証: 「入出金内容」「入出金額」が両方とも「出金」を含むケース等で、
  //      既に別フィールドが確定済みの列を候補から除くことで無関係な候補の混入を防ぐ)
  //   3. ヘッダーキーワードが1件もマッチしない → 型ベースの候補ランキングにフォールバック
  const resolved = {} as Record<MappingColumnField, ColumnCandidate[]>
  for (const field of FIELD_ORDER) {
    const fallbackType = FIELD_FALLBACK_TYPE[field]
    const matches = headerMatches[field]

    if (matches.length === 1) {
      resolved[field] = matches
      continue
    }

    const unclaimedMatches = matches.filter((match) => !claimedColumns.has(match.columnIndex))
    if (unclaimedMatches.length > 0) {
      resolved[field] = rankCandidatesByType(unclaimedMatches, dataRows, fallbackType)
    } else {
      resolved[field] = rankColumnsByType(dataRows, fallbackType, headerRow, claimedColumns)
    }
  }

  return {
    headerRowCount: headerRow ? 1 : 0,
    dateColumn: resolved.dateColumn,
    descriptionColumn: resolved.descriptionColumn,
    amountMode: inferAmountMode(resolved),
    amountColumn: resolved.amountColumn,
    debitColumn: resolved.debitColumn,
    creditColumn: resolved.creditColumn,
    balanceColumn: resolved.balanceColumn,
    label: null,
    formatGroupId: null,
    isSettled: null,
  }
}

/**
 * amountModeは、各フィールドの最終的な解決結果(候補が1件=一意に絞り込めた)を基準に判定する。
 * ヘッダーキーワードで一意にマッチした場合だけでなく、型ベースのフォールバックの結果
 * 候補が1件に絞り込めた場合も「一意」として扱う(実データ検証: 残高列がヘッダーで確定した
 * 結果、残る数値列が1つだけになり金額列が一意に定まるケース等)。
 *
 * debitColumn・creditColumnが同一の列インデックスに絞り込まれた場合はdebit_credit_splitとは
 * 判定しない。実データ検証(楽天銀行の「入出金(円)」1列)で判明: debitColumn・creditColumnは
 * それぞれ独立に解決される(ヘッダーの曖昧マッチをclaimedColumnsで絞り込む経路と、型
 * フォールバックの経路)ため、単一の符号付き金額列が両方から偶然同じ列に解決されることがあり、
 * その場合は実際には出金・入金の2列ではなく1列の符号付き金額を意味する。
 */
function inferAmountMode(resolved: Record<MappingColumnField, ColumnCandidate[]>): AmountMode | null {
  if (
    resolved.debitColumn.length === 1 &&
    resolved.creditColumn.length === 1 &&
    resolved.debitColumn[0].columnIndex !== resolved.creditColumn[0].columnIndex
  ) {
    return 'debit_credit_split'
  }
  if (resolved.amountColumn.length === 1) return 'single_signed'
  return null
}

function detectHeaderRow(rows: string[][]): { headerRow: string[] | null; dataRows: string[][] } {
  if (rows.length === 0) return { headerRow: null, dataRows: [] }

  const firstRow = rows[0]
  const allKeywords = Object.values(COLUMN_KEYWORD_DICTIONARY).flatMap((tiers) => tiers.flat())
  const looksLikeHeader = firstRow.some((cell) =>
    allKeywords.some((keyword) => normalizeHeaderCell(cell).includes(keyword)),
  )

  return looksLikeHeader ? { headerRow: firstRow, dataRows: rows.slice(1) } : { headerRow: null, dataRows: rows }
}

function normalizeHeaderCell(cell: string): string {
  return cell.normalize('NFKC').trim()
}

/**
 * フィールドのキーワード階層(tier)を先頭から順に試し、1件でもマッチする階層が
 * 見つかった時点でそれを返す(columnKeywordDictionary.tsのdocstring参照)。
 */
function matchHeaderKeywords(field: MappingColumnField, headerRow: string[]): ColumnCandidate[] {
  const tiers = COLUMN_KEYWORD_DICTIONARY[field]
  for (const keywords of tiers) {
    const candidates: ColumnCandidate[] = []
    headerRow.forEach((header, columnIndex) => {
      const normalized = normalizeHeaderCell(header)
      if (keywords.some((keyword) => normalized.includes(keyword))) {
        candidates.push({ columnIndex, headerName: header })
      }
    })
    if (candidates.length > 0) return candidates
  }
  return []
}

function rankCandidatesByType(
  candidates: ColumnCandidate[],
  dataRows: string[][],
  type: ColumnValueType,
): ColumnCandidate[] {
  return [...candidates].sort(
    (a, b) => typeScore(b.columnIndex, dataRows, type) - typeScore(a.columnIndex, dataRows, type),
  )
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
