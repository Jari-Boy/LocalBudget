import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { readCsv } from './readCsv'
import { previewMappingRows } from './previewMappingRows'

export interface MappingDefinitionCandidateMatch {
  definition: ImportMappingDefinition
  /** readCsvが返した「行×列」の生データ。呼び出し側が再度readCsvし直す必要がないよう保持する */
  rows: string[][]
}

/**
 * 全マッピング定義候補それぞれに対し、実際にパース(readCsv→previewMappingRows)を試み、
 * CSVに合うと判断した候補のみを返す(計画Issue #78、docs/domain/statement-import.md 1.4・1.5手順1)。
 * 単純な列名パターンマッチ等のヒューリスティックな「ファイルの中身からの推測」ではなく、実際の変換処理の
 * 試行による絞り込みである。候補ごとにencoding/delimiterが異なりうるため、readCsv自体も候補ごとに個別実行する。
 * 指定した列がCSVに見つからない候補は除外する。為替レートの補足行のように一部の行だけ読み取れない場合は
 * それだけで除外せず(計画Issue #151)、読み取れる行が1行以上あり、読み取れない行以上のときに一致とする。日付の書式が
 * 違うなど、ほとんどの行が読み取れない候補は別の形式とみなして除外する。データ行が無い(見出しだけの)CSVは、
 * 列が見つかれば一致とする。
 */
export function resolveMappingDefinitionCandidates(
  bytes: Uint8Array,
  candidates: readonly ImportMappingDefinition[],
): MappingDefinitionCandidateMatch[] {
  const matches: MappingDefinitionCandidateMatch[] = []

  for (const candidate of candidates) {
    try {
      const rows = readCsv(bytes, { encoding: candidate.encoding, delimiter: candidate.delimiter })
      const preview = previewMappingRows(rows, candidate)
      if (preview.columnError !== null) continue
      const readable = preview.rows.filter((row) => row.record !== null).length
      const unreadable = preview.rows.length - readable
      if (preview.rows.length > 0 && (readable === 0 || readable < unreadable)) continue
      matches.push({ definition: candidate, rows })
    } catch {
      continue
    }
  }

  return matches
}
