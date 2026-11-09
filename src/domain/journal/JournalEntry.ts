export type JournalLineSide = 'debit' | 'credit'

export type JournalEntrySourceType =
  | 'manual'
  | 'external_import'
  | 'recurring_generated'
  | 'initial_balance'
  | 'balance_adjustment'
  | 'expense_splitting'

export interface JournalLine {
  id: number
  journalEntryId: number
  accountId: number
  projectId: number | null
  /** 誰の行か。必須(継承=nullは廃止、docs/domain/household-members.md 1.2節、計画Issue #169) */
  householdMemberId: number
  counterpartyId: number | null
  /** 精算バッチのタグ(docs/domain/settlement.md、計画Issue #133)。projectIdとは独立 */
  settlementBatchId: number | null
  side: JournalLineSide
  amount: number
  createdAt: string
}

export interface JournalEntry {
  id: number
  entryDate: string
  memo: string | null
  /** 自由な補足(計画Issue #144)。摘要(memo)とは別の任意項目で、仕訳ごとに1つ */
  comment: string | null
  currency: string
  sourceType: JournalEntrySourceType
  /**
   * 起票者(この仕訳を切った主体、docs/domain/journal.md 1.1)。NOT NULL。
   * journal_lines.householdMemberId(誰の行か)とは役割が異なり、明細行の世帯メンバーの
   * 入力時の既定値になる。明細行は常に自分の世帯メンバーを持つため、読み取り側で
   * 起票者へフォールバックはしない(household-members.md 1.2節、計画Issue #169)。
   */
  householdMemberId: number
  /**
   * 生成元の定期取引ルール(docs/domain/recurring-transactions.md 1.5)。参照のみで複式簿記の
   * 整合性検証には関与しない。sourceType = 'recurring_generated'の仕訳でのみ非null
   */
  generatedFromRuleId: number | null
  createdAt: string
  updatedAt: string
  lines: JournalLine[]
}

export interface JournalLineInput {
  /**
   * 既存の明細行のid(計画Issue #132)。JournalEntryRepository.updateに渡した場合のみ意味を持ち、
   * 指定された行は同じidのままUPDATEされる。
   * 未指定の行は新規INSERT、入力から消えた既存行はDELETEされる。createでは無視される。
   */
  id?: number
  accountId: number
  projectId?: number | null
  /** 誰の行か。必須。科目に既定の世帯メンバーがある行は、その既定値を明示して渡す */
  householdMemberId: number
  counterpartyId?: number | null
  settlementBatchId?: number | null
  side: JournalLineSide
  amount: number
}

export interface CreateJournalEntryInput {
  entryDate: string
  memo?: string | null
  comment?: string | null
  currency?: string
  sourceType?: JournalEntrySourceType
  /** 起票者(docs/domain/journal.md 1.1「起票者」)。必須、未指定では仕訳を作成できない */
  householdMemberId: number
  lines: JournalLineInput[]
  /**
   * 外部明細取込(docs/domain/statement-import.md 1.5 手順7)の場合、この仕訳と同一DBトランザクション
   * で書き込むexternal_transaction_refs(docs/domain/reconciliation.md 2章)のスナップショット。
   * journalEntryIdは仕訳作成後に確定するため含めない。
   */
  externalTransactionRef?: CreateExternalTransactionRefTarget
  /** 生成元の定期取引ルール(docs/domain/recurring-transactions.md 1.5)。参照のみ、任意 */
  generatedFromRuleId?: number | null
}

export interface CreateExternalTransactionRefTarget {
  accountId: number
  externalId: string
  entryDate: string
  description: string
  amount: number
  externalBalanceAfter?: number | null
  isSettled?: boolean | null
}

export interface UpdateJournalEntryInput {
  entryDate: string
  memo?: string | null
  /** 未指定の場合は既存のコメントを維持する。nullを指定すると消去する(計画Issue #144) */
  comment?: string | null
  lines: JournalLineInput[]
}
