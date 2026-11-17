import type { ImportMappingDefinition } from './ImportMappingDefinition'
import type { ImportedRecord } from './ImportedRecord'
import { MappingColumnNotFoundError } from './MappingColumnNotFoundError'
import { previewMappingRows, type MappingPreviewRow } from './previewMappingRows'
import { resolveExternalIds } from './resolveExternalIds'
import {
  assignApproximateDuplicateCandidates,
  type ApproximateDuplicateSearchOptions,
  type ExistingTransactionSummary,
} from './duplicateDetection'
import type { StatementImportReviewRecord } from './buildStatementImportReview'

export interface MultiFileInput {
  fileName: string
  /** readCsvが返した「行×列」の生データ */
  rows: string[][]
}

export interface BuildMultiFileStatementImportReviewParams {
  files: readonly MultiFileInput[]
  definition: ImportMappingDefinition
  /** 対象科目の既存外部取引ID集合(取込済みとの完全一致判定、1.6手順2-3) */
  existingExternalIds: ReadonlySet<string>
  existingTransactions: readonly ExistingTransactionSummary[]
  approximateDuplicateOptions: ApproximateDuplicateSearchOptions
}

/** 複数ファイル取込の1行。ファイル名・CSV上の行番号・ファイル間の重複の相手を持つ */
export interface MultiFileReviewRecord extends StatementImportReviewRecord {
  fileName: string
  /** CSV上の行番号(1始まり、見出し行を含む) */
  sourceRowNumber: number
  /**
   * ファイル間の重複のとき、重複元(先のファイルに残した行)の`records`上のインデックス。重複でなければnull。
   * 重複行は`isExactDuplicate`もtrueになり、取込済みと同じく既定では取り込まない
   */
  crossFileDuplicateOf: number | null
}

export interface MultiFileSummary {
  fileName: string
  /** 取り込める行の最も早い・遅い取引日。取り込める行が無ければnull */
  periodStart: string | null
  periodEnd: string | null
  recordCount: number
}

export interface MultiFileStatementImportReviewResult {
  /** 期間の早い順に並べたファイルの要約 */
  files: MultiFileSummary[]
  records: MultiFileReviewRecord[]
  unreadableRows: Array<Pick<MappingPreviewRow, 'rowNumber' | 'cells' | 'error'> & { fileName: string }>
}

interface PendingRecord {
  record: ImportedRecord
  fileName: string
  sourceRowNumber: number
  externalId: string
  isExactDuplicate: boolean
  /** 重複元の仮ID(連結前の通し番号) */
  duplicateOfTempId: number | null
  tempId: number
}

/**
 * 複数CSV(同じマッピング定義で読めるもの)を1回分の取込として連結し、重複防止(docs/domain/statement-import.md 1.6)の
 * 判定結果を付ける(計画Issue #214)。
 *
 * 外部取引IDの代替ハッシュ(resolveExternalIds)は**ファイル単位**で算出する。連結した全体で出現順インデックスを
 * 振ると、期間が重なるファイルで同日・同額・同摘要の明細が連番化し、重なった分が「新規」と誤判定されて
 * 二重計上するため。ファイルを期間(最も早い取引日)の早い順に処理し、同じ外部取引IDが先のファイルに既にあれば
 * 後のファイルの行を「ファイル間の重複」にする。重複行の外部取引IDは、利用者が取り込むと選んだときに
 * UNIQUE(account_id, external_id)に当たらないよう別の値にする。
 *
 * 2ファイル以上のときは、連結後を取引日の昇順に並べる(同じ日の中は、ファイルの順・CSVの行の順を保つ)。
 * 1ファイルのときは、従来どおりCSVの並びのままにする。
 * 列構成が定義と一致しない場合は、MappingColumnNotFoundErrorを投げる(呼び出し側が、取込前に合わないファイルを除く)。
 */
export function buildMultiFileStatementImportReview(
  params: BuildMultiFileStatementImportReviewParams,
): MultiFileStatementImportReviewResult {
  const { files, definition, existingExternalIds, existingTransactions, approximateDuplicateOptions } = params

  const parsed = files.map((file, order) => {
    const preview = previewMappingRows(file.rows, definition)
    if (preview.columnError !== null) {
      throw new MappingColumnNotFoundError(preview.columnError.fieldName, preview.columnError.columnSpec)
    }
    const readable = preview.rows.flatMap((row) => (row.record === null ? [] : [{ record: row.record, rowNumber: row.rowNumber }]))
    const dates = readable.map((r) => r.record.entryDate).sort()
    return {
      file,
      order,
      readable,
      unreadable: preview.rows.filter((row) => row.record === null),
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
    }
  })

  const ordered = [...parsed].sort((a, b) => {
    if (a.periodStart === b.periodStart) return a.order - b.order
    if (a.periodStart === null) return 1
    if (b.periodStart === null) return -1
    return a.periodStart < b.periodStart ? -1 : 1
  })

  const firstById = new Map<string, number>()
  const duplicateCountById = new Map<string, number>()
  const pending: PendingRecord[] = []

  for (const entry of ordered) {
    const ids = resolveExternalIds(entry.readable.map((r) => r.record))
    entry.readable.forEach((item, i) => {
      const id = ids[i]
      const tempId = pending.length
      const first = firstById.get(id)
      const isExactDuplicate = existingExternalIds.has(id)
      if (first === undefined) {
        firstById.set(id, tempId)
        pending.push({
          record: item.record,
          fileName: entry.file.fileName,
          sourceRowNumber: item.rowNumber,
          externalId: id,
          isExactDuplicate,
          duplicateOfTempId: null,
          tempId,
        })
        return
      }
      const count = (duplicateCountById.get(id) ?? 0) + 1
      duplicateCountById.set(id, count)
      pending.push({
        record: item.record,
        fileName: entry.file.fileName,
        sourceRowNumber: item.rowNumber,
        externalId: `${id}#file-dup-${count}`,
        isExactDuplicate: true,
        duplicateOfTempId: first,
        tempId,
      })
    })
  }

  const sorted = files.length > 1 ? [...pending].sort((a, b) => compareDates(a.record.entryDate, b.record.entryDate)) : pending
  const finalIndexOf = new Map(sorted.map((p, index) => [p.tempId, index]))

  // 重複(取込済みとの完全一致・ファイル間の重複)の行は確定版候補を持たない。1件の既存明細は最も近い1行にだけ紐づける
  const candidates = assignApproximateDuplicateCandidates(
    sorted.map((p) => (p.isExactDuplicate ? null : p.record)),
    existingTransactions,
    approximateDuplicateOptions,
  )
  const records: MultiFileReviewRecord[] = sorted.map((p, index) => ({
    record: p.record,
    externalId: p.externalId,
    isExactDuplicate: p.isExactDuplicate,
    approximateCandidates: candidates[index],
    fileName: p.fileName,
    sourceRowNumber: p.sourceRowNumber,
    crossFileDuplicateOf: p.duplicateOfTempId === null ? null : (finalIndexOf.get(p.duplicateOfTempId) ?? null),
  }))

  return {
    files: ordered.map((entry) => ({
      fileName: entry.file.fileName,
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      recordCount: entry.readable.length,
    })),
    records,
    unreadableRows: ordered.flatMap((entry) =>
      entry.unreadable.map(({ rowNumber, cells, error }) => ({ fileName: entry.file.fileName, rowNumber, cells, error })),
    ),
  }
}

function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
