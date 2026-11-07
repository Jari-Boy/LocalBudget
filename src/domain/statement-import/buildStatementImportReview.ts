import type { ImportMappingDefinition } from './ImportMappingDefinition'
import type { ImportedRecord } from './ImportedRecord'
import { MappingColumnNotFoundError } from './MappingColumnNotFoundError'
import { previewMappingRows, type MappingPreviewRow } from './previewMappingRows'
import { resolveExternalIds } from './resolveExternalIds'
import {
  findApproximateDuplicateCandidates,
  partitionByExternalIdDuplicate,
  type ApproximateDuplicateSearchOptions,
  type ExistingTransactionSummary,
} from './duplicateDetection'

export interface BuildStatementImportReviewParams {
  /** readCsvが返した「行×列」の生データ */
  rows: string[][]
  definition: ImportMappingDefinition
  /** 重複防止フロー(1.6手順2-3)の完全一致判定に使う、対象科目の既存外部取引ID集合 */
  existingExternalIds: ReadonlySet<string>
  /** 確定版候補のサジェスト(1.6)に使う、対象科目の既存明細一覧 */
  existingTransactions: readonly ExistingTransactionSummary[]
  approximateDuplicateOptions: ApproximateDuplicateSearchOptions
}

export interface StatementImportReviewRecord {
  record: ImportedRecord
  /** resolveExternalIdsで解決済みの外部取引ID(CSV由来またはハッシュ代替) */
  externalId: string
  /** 既存のexternal_transaction_refsとexternalIdが完全一致するか(1.6手順3) */
  isExactDuplicate: boolean
  /** 日付・金額が近い既存明細(確定版候補、1.6) */
  approximateCandidates: ExistingTransactionSummary[]
}

export interface StatementImportReviewResult {
  records: StatementImportReviewRecord[]
  /**
   * 読み取れなかった行(日付が空の補足行など)。取り込み対象には含めず、画面で行番号・元のセル・
   * 理由を見せる(計画Issue #151)。すべて読み取れれば空
   */
  unreadableRows: Array<Pick<MappingPreviewRow, 'rowNumber' | 'cells' | 'error'>>
  /**
   * CSVレコード群のうちbalance_afterが取得できた最後の値。残高照合(reconciliation.md 1.5)の
   * 外部残高として使う。CSVに残高列が無い、またはいずれの行にも値が無ければnull
   */
  latestExternalBalance: number | null
}

/**
 * readCsvが返した生データを、ImportMappingDefinitionでImportedRecord[]へ変換したうえで、
 * 重複防止フロー(docs/domain/statement-import.md 1.6)の判定結果を1レコードずつ付与する。
 * CSV取込レビュー画面(計画Issue #76)がレビュー一覧を組み立てる際の入力データとして使う。
 * 列構成が定義と一致しない場合、mapRowsToImportedRecordsが投げるMappingColumnNotFoundErrorを
 * そのまま伝播させる(docs/domain/statement-import.md 1.4、呼び出し側でエラー表示に変換する)。
 */
export function buildStatementImportReview(
  params: BuildStatementImportReviewParams,
): StatementImportReviewResult {
  const { rows, definition, existingExternalIds, existingTransactions, approximateDuplicateOptions } =
    params

  const preview = previewMappingRows(rows, definition)
  if (preview.columnError !== null) {
    throw new MappingColumnNotFoundError(preview.columnError.fieldName, preview.columnError.columnSpec)
  }
  const records = preview.rows.flatMap((row) => (row.record === null ? [] : [row.record]))
  const unreadableRows = preview.rows
    .filter((row) => row.record === null)
    .map(({ rowNumber, cells, error }) => ({ rowNumber, cells, error }))
  const externalIds = resolveExternalIds(records)
  const { duplicateIndices } = partitionByExternalIdDuplicate(externalIds, existingExternalIds)
  const duplicateIndexSet = new Set(duplicateIndices)

  const reviewRecords = records.map((record, index) => ({
    record,
    externalId: externalIds[index],
    isExactDuplicate: duplicateIndexSet.has(index),
    approximateCandidates: findApproximateDuplicateCandidates(
      record,
      existingTransactions,
      approximateDuplicateOptions,
    ),
  }))

  return {
    records: reviewRecords,
    unreadableRows,
    latestExternalBalance: resolveLatestExternalBalance(records),
  }
}

function resolveLatestExternalBalance(records: readonly ImportedRecord[]): number | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const balance = records[i].balanceAfter
    if (balance !== null) return balance
  }
  return null
}
