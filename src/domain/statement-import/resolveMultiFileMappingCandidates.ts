import type { ImportMappingDefinition } from './ImportMappingDefinition'
import { previewMappingRows } from './previewMappingRows'
import { readCsv } from './readCsv'
import { resolveMappingDefinitionCandidates } from './resolveMappingDefinitionCandidates'

export interface CsvFileBytes {
  fileName: string
  bytes: Uint8Array
}

export interface ExcludedFileReason {
  /** noDefinition: どのマッピング定義でも読めない / otherDefinition: ほかの定義なら読めるが、選んだ定義では読めない */
  kind: 'noDefinition' | 'otherDefinition'
  /** 選んだ定義で見つからなかった列(項目名と指定)。列以外の理由(読める行が無い等)ならnull */
  missingColumn: { fieldName: string; columnSpec: string } | null
}

export interface ExcludedFile {
  fileName: string
  reason: ExcludedFileReason
}

export interface MultiFileMappingMatch {
  definition: ImportMappingDefinition
  /** この定義で読めたファイルと、その生データ(行×列)。入力の順 */
  files: Array<{ fileName: string; rows: string[][] }>
  /** この定義では読めず、取り込まないファイル */
  excluded: ExcludedFile[]
}

/**
 * 複数CSVに共通して使えるマッピング定義の候補を決める(計画Issue #214、docs/domain/statement-import.md 1.5手順1)。
 * ファイルごとにresolveMappingDefinitionCandidatesで実パースを試み、より多くのファイルを読める定義だけを
 * 候補として返す。その定義で読めないファイルは、全体を止めずに理由つきで除外する。読めるファイル数が同じ定義が
 * 複数あれば、すべて返す(利用者が表示名で選ぶ)。どのファイルも読める定義が無ければ空配列を返す。
 * 1ファイルだけのときは、resolveMappingDefinitionCandidatesと同じ絞り込みになる。
 */
export function resolveMultiFileMappingCandidates(
  files: readonly CsvFileBytes[],
  definitions: readonly ImportMappingDefinition[],
): MultiFileMappingMatch[] {
  const perFile = files.map((file) => ({ file, matches: resolveMappingDefinitionCandidates(file.bytes, definitions) }))

  const rowsByDefinition = new Map<number, Map<string, string[][]>>()
  for (const { file, matches } of perFile) {
    for (const match of matches) {
      const byFile = rowsByDefinition.get(match.definition.id) ?? new Map<string, string[][]>()
      byFile.set(file.fileName, match.rows)
      rowsByDefinition.set(match.definition.id, byFile)
    }
  }

  const mostFiles = Math.max(0, ...[...rowsByDefinition.values()].map((byFile) => byFile.size))
  if (mostFiles === 0) return []

  return definitions
    .filter((definition) => rowsByDefinition.get(definition.id)?.size === mostFiles)
    .map((definition) => {
      const byFile = rowsByDefinition.get(definition.id)!
      return {
        definition,
        files: perFile.filter(({ file }) => byFile.has(file.fileName)).map(({ file }) => ({ fileName: file.fileName, rows: byFile.get(file.fileName)! })),
        excluded: perFile
          .filter(({ file }) => !byFile.has(file.fileName))
          .map(({ file, matches }) => ({
            fileName: file.fileName,
            reason: {
              kind: matches.length === 0 ? ('noDefinition' as const) : ('otherDefinition' as const),
              missingColumn: findMissingColumn(file.bytes, definition),
            },
          })),
      }
    })
}

function findMissingColumn(bytes: Uint8Array, definition: ImportMappingDefinition): ExcludedFileReason['missingColumn'] {
  try {
    const rows = readCsv(bytes, { encoding: definition.encoding, delimiter: definition.delimiter })
    return previewMappingRows(rows, definition).columnError
  } catch {
    return null
  }
}
