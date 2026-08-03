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
 *
 * 各フィールドはキーワードの配列ではなく、階層(tier)の配列として持つ。マッチング側
 * (matchHeaderKeywords)は先頭の階層から順に試し、1件でもマッチする階層が見つかった時点で
 * それ以降の(より曖昧になりうる)階層は試さない。これは実データ検証(楽天カード等)で判明した、
 * 「利用金額」と「11月支払金額」のように、より広いキーワード(「金額」)だけでは複数列に
 * 曖昧にマッチしてしまう実際のヘッダー文言に対応するため。より具体的なキーワード
 * (「利用金額」)を先に試すことで、広いキーワードに頼らず一意に確定できるケースを増やす。
 */
export const COLUMN_KEYWORD_DICTIONARY: Record<MappingColumnField, readonly (readonly string[])[]> = {
  dateColumn: [
    ['日付', '取引日', 'ご利用日'],
    // 「ご」が付かない「利用日」(例: PayPayカードの「利用日/キャンセル日」)向けの
    // より広い階層。「ご利用日」を含む文言は上の階層で先に一意にマッチするため、
    // ここに到達するのは「ご」の無い表記のときだけ
    ['利用日'],
  ],
  descriptionColumn: [['摘要', '内容', 'ご利用先', '利用店名']],
  debitColumn: [['出金']],
  creditColumn: [['入金']],
  amountColumn: [
    // 「利用金額」(実際のクレジットカード明細の表記)を、より広い「金額」より先に試す
    ['利用金額'],
    ['金額'],
  ],
  balanceColumn: [['残高']],
}
