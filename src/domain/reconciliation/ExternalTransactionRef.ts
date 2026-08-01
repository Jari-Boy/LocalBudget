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
  isSettled?: boolean | null
}
