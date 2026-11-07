import type { ImportMappingDefinition } from './ImportMappingDefinition'
import type { ImportedRecord } from './ImportedRecord'
import { MappingColumnNotFoundError } from './MappingColumnNotFoundError'
import {
  MappingCellError,
  mapRowToImportedRecord,
  resolveMappingColumns,
} from './mapRowsToImportedRecords'

export interface MappingPreviewRow {
  /** CSV上の行番号(1始まり、見出し行を含む) */
  rowNumber: number
  /** 元のセル値 */
  cells: string[]
  record: ImportedRecord | null
  /** 読み取れなかった理由。読み取れた行はnull */
  error: 'invalidDate' | 'invalidAmount' | 'unknown' | null
}

export interface MappingPreview {
  rows: MappingPreviewRow[]
  /** 指定した列がCSVに見つからない場合の項目と指定。見つかれば行は空になる */
  columnError: { fieldName: string; columnSpec: string } | null
}

/**
 * マッピング編集画面のプレビュー用に、実際の取込と同じ変換(mapRowToImportedRecord)を行ごとに
 * 適用する。mapRowsToImportedRecordsと異なり、読み取れない行は例外にせず理由つきで返す
 * (docs/domain/statement-import.md 1.4)。
 */
export function previewMappingRows(rows: string[][], definition: ImportMappingDefinition): MappingPreview {
  let columns
  try {
    columns = resolveMappingColumns(rows, definition)
  } catch (error) {
    if (error instanceof MappingColumnNotFoundError) {
      return { rows: [], columnError: { fieldName: error.fieldName, columnSpec: error.columnSpec } }
    }
    throw error
  }

  const previewRows = rows.slice(definition.headerRowCount).map((cells, i): MappingPreviewRow => {
    const rowNumber = definition.headerRowCount + i + 1
    try {
      return { rowNumber, cells, record: mapRowToImportedRecord(cells, definition, columns), error: null }
    } catch (error) {
      return {
        rowNumber,
        cells,
        record: null,
        error: error instanceof MappingCellError ? error.kind : 'unknown',
      }
    }
  })
  return { rows: previewRows, columnError: null }
}
