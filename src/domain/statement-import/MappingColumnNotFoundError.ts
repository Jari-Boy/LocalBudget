/**
 * マッピング定義が指定する列(ヘッダー名または列インデックス)が、実際のCSVの列構成に
 * 見つからない場合にスローされるドメインエラー(docs/domain/statement-import.md 1.4)。
 * 「このファイルは◯◯用のフォーマットと一致しません」のようにレビュー画面へ伝えるために使う。
 */
export class MappingColumnNotFoundError extends Error {
  readonly fieldName: string
  readonly columnSpec: string

  constructor(fieldName: string, columnSpec: string) {
    super(`import mapping column not found: field=${fieldName}, columnSpec=${columnSpec}`)
    this.name = 'MappingColumnNotFoundError'
    this.fieldName = fieldName
    this.columnSpec = columnSpec
  }
}
