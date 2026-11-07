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
 * 指定した列がCSVに見つからない候補、読み取れる行が1行も無い候補は除外する。為替レートの補足行のように
 * 一部の行が読み取れなくても、それだけでは除外しない(計画Issue #151)。読み取れない行の方が多い場合の警告は
 * 画面側が出す。複数の候補が通るときは、読み取れない行が最も少ない候補だけを残す(日付の書式違いなどで
 * 読めない行が多い別の定義を除く。確定明細と速報明細のように列が同じ定義は、数が同じなので残る)。
 * データ行が無い(見出しだけの)CSVは、列が見つかれば一致とする。
 */
export function resolveMappingDefinitionCandidates(
  bytes: Uint8Array,
  candidates: readonly ImportMappingDefinition[],
): MappingDefinitionCandidateMatch[] {
  const matches: Array<MappingDefinitionCandidateMatch & { unreadable: number }> = []

  for (const candidate of candidates) {
    try {
      const rows = readCsv(bytes, { encoding: candidate.encoding, delimiter: candidate.delimiter })
      const preview = previewMappingRows(rows, candidate)
      if (preview.columnError !== null) continue
      const readable = preview.rows.filter((row) => row.record !== null).length
      if (preview.rows.length > 0 && readable === 0) continue
      matches.push({ definition: candidate, rows, unreadable: preview.rows.length - readable })
    } catch {
      continue
    }
  }

  const fewest = Math.min(...matches.map((match) => match.unreadable))
  return matches
    .filter((match) => match.unreadable === fewest)
    .map(({ definition, rows }) => ({ definition, rows }))
}
