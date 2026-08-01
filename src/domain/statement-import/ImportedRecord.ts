/**
 * 外部明細の中間表現(docs/domain/statement-import.md 1.2)。
 * 金融機関ごとのCSVフォーマットの差異はImportMappingDefinitionに基づく変換で吸収され、
 * この共通フォーマットに正規化される。複式簿記の概念(借方/貸方)はこの段階では持ち込まない。
 */
export interface ImportedRecord {
  /** 取引日、ISO形式('YYYY-MM-DD') */
  entryDate: string
  /** 摘要、生文字列(正規化前) */
  description: string
  /**
   * 符号付き整数。正 = 対象科目(取込対象として選んだ口座/カード)の残高が増える方向、
   * 負 = 減る方向。借方/貸方への変換はこの段階では行わない
   */
  amount: number
  /** 取引後残高。CSVに残高列がある場合のみ */
  balanceAfter: number | null
  /** 外部取引の一意キー。CSVに列がある場合のみ。無ければレビュー確定時に正規化ハッシュで代替する */
  externalId: string | null
  /**
   * 確定済みか。個々のレコードの内容を解析するのではなく、マッピングに使った
   * ImportMappingDefinition.isSettledをそのまま引き継ぐ
   */
  isSettled: boolean | null
}
