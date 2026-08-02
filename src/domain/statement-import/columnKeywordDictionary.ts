export type MappingColumnField =
  | 'dateColumn'
  | 'descriptionColumn'
  | 'debitColumn'
  | 'creditColumn'
  | 'amountColumn'
  | 'balanceColumn'

/**
 * ヘッダー文言→フィールドの対応表(docs/domain/statement-import.md「目標」列マッピングの推測)。
 * 判定ロジック(inferMappingDefinitionDraft)からは分離した独立モジュールとして管理し、
 * ロジックにハードコーディングしない。JSON化はしない(実行時の設定変更・ユーザー編集は
 * 対象外であり、TypeScriptの型チェックの恩恵を優先するため)。
 */
export const COLUMN_KEYWORD_DICTIONARY: Record<MappingColumnField, readonly string[]> = {
  dateColumn: ['日付', '取引日', 'ご利用日'],
  descriptionColumn: ['摘要', '内容', 'ご利用先'],
  debitColumn: ['出金'],
  creditColumn: ['入金'],
  amountColumn: ['金額'],
  balanceColumn: ['残高'],
}
