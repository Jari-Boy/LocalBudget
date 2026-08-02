/**
 * CSVの生バイト列からエンコーディング(utf-8/shift-jis)を推測する(docs/domain/statement-import.md
 * 1.3)。列マッピングの推測(inferMappingDefinitionDraft)とは独立した別の純粋関数として提供する。
 * UTF-8として厳密デコードできればutf-8、デコードに失敗すれば(不正なバイト列)、日本の金融機関CSVで
 * 最も一般的なshift-jisにフォールバックする。1.3が定める「エンコーディングはマッピング定義側で
 * 明示的に指定する(自動判定しない)」原則の例外であり、まだ定義が存在しないドラフト生成時の
 * ブートストラップ用途に限定する。保存済み定義を使う通常のインポート時には使用しない。
 */
export function inferEncoding(bytes: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    return 'shift-jis'
  }
}
