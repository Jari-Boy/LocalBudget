import Papa from 'papaparse'

export interface CsvReadOptions {
  /** 文字コード(例: 'utf-8', 'shift-jis')。TextDecoderがサポートするラベルを指定する */
  encoding: string
  /** 区切り文字(例: ',', '\t') */
  delimiter: string
}

/**
 * CSVのバイト列を「行×列」の生データ(セル値の文字列の二次元配列)へ変換する。
 * 文字コード・区切り文字・改行コードの違いを吸収する構文レベルの読み取りのみを担い、
 * 各列が何を意味するか(日付か金額か等)の解釈は行わない(docs/domain/statement-import.md 1.3・3章)。
 */
export function readCsv(bytes: Uint8Array, options: CsvReadOptions): string[][] {
  const text = new TextDecoder(options.encoding).decode(bytes)
  const result = Papa.parse<string[]>(text, {
    delimiter: options.delimiter,
    skipEmptyLines: true,
  })
  return result.data
}
