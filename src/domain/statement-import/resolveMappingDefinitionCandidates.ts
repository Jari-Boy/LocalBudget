import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { readCsv } from './readCsv'
import { mapRowsToImportedRecords } from './mapRowsToImportedRecords'

export interface MappingDefinitionCandidateMatch {
  definition: ImportMappingDefinition
  /** readCsvが返した「行×列」の生データ。呼び出し側が再度readCsvし直す必要がないよう保持する */
  rows: string[][]
}

/**
 * 対象科目で使える全マッピング定義候補それぞれに対し、実際にパース(readCsv→
 * mapRowsToImportedRecords)を試み、エラーなく成功した候補のみを返す(計画Issue #78、
 * docs/domain/statement-import.md 1.4・1.5手順1)。単純な列名パターンマッチ等のヒューリスティックな
 * 「ファイルの中身からの推測」ではなく、実際の変換処理の試行によるエラーなしでの絞り込みである。
 * 候補ごとにencoding/delimiterが異なりうるため、readCsv自体も候補ごとに個別実行する。
 * MappingColumnNotFoundErrorに限らず、日付書式不一致・金額パース失敗等の汎用Errorも含め、
 * 例外の種類を問わず投げられた候補は失敗として除外する。
 */
export function resolveMappingDefinitionCandidates(
  bytes: Uint8Array,
  candidates: readonly ImportMappingDefinition[],
): MappingDefinitionCandidateMatch[] {
  const matches: MappingDefinitionCandidateMatch[] = []

  for (const candidate of candidates) {
    try {
      const rows = readCsv(bytes, { encoding: candidate.encoding, delimiter: candidate.delimiter })
      mapRowsToImportedRecords(rows, candidate)
      matches.push({ definition: candidate, rows })
    } catch {
      continue
    }
  }

  return matches
}
