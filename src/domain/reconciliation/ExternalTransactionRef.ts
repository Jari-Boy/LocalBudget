/**
 * 突合マスタ(external_transaction_refs、docs/domain/reconciliation.md 2.1)。
 * インポート時点のImportedRecordの内容を不変のスナップショットとして保持し、事後編集された
 * journal_entries/journal_linesとの比較(1.4 ライフサイクル)に使う。
 */
export interface ExternalTransactionRef {
  id: number
  accountId: number
  journalEntryId: number
  externalId: string
  entryDate: string
  description: string
  amount: number
  externalBalanceAfter: number | null
  /** 取込時のCSV上の行の順番(計画Issue #205)。既存データはnull(id順で代用) */
  rowOrder: number | null
  isSettled: boolean | null
  importedAt: string
}

export interface CreateExternalTransactionRefInput {
  accountId: number
  journalEntryId: number
  externalId: string
  entryDate: string
  description: string
  amount: number
  externalBalanceAfter?: number | null
  rowOrder?: number | null
  isSettled?: boolean | null
  /** 取込日時。同じ取込の行を同じ値にそろえるために指定する(省略時はDBの現在時刻、計画Issue #205) */
  importedAt?: string
}
