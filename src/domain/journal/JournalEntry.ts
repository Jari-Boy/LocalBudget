import type { JournalEntryLinkTarget } from './JournalEntryLink'

export type JournalLineSide = 'debit' | 'credit'

export type JournalEntrySourceType =
  | 'manual'
  | 'external_import'
  | 'recurring_generated'
  | 'initial_balance'
  | 'balance_adjustment'

export interface JournalLine {
  id: number
  journalEntryId: number
  accountId: number
  projectId: number | null
  householdMemberId: number | null
  counterpartyId: number | null
  side: JournalLineSide
  amount: number
  createdAt: string
}

export interface JournalEntry {
  id: number
  entryDate: string
  memo: string | null
  currency: string
  sourceType: JournalEntrySourceType
  /**
   * 起票者(この仕訳を切った主体、docs/domain/journal.md 1.1)。NOT NULL。
   * journal_lines.householdMemberId(明細の上書き)とは役割が異なり、科目に既定値が無く
   * 明細側も未指定の行の実効メンバーのフォールバック先になる(household-members.md 1.2節、
   * resolveEffectiveHouseholdMemberId参照)。
   */
  householdMemberId: number
  createdAt: string
  updatedAt: string
  lines: JournalLine[]
}

export interface JournalLineInput {
  accountId: number
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  side: JournalLineSide
  amount: number
}

export interface CreateJournalEntryInput {
  entryDate: string
  memo?: string | null
  currency?: string
  sourceType?: JournalEntrySourceType
  /** 起票者(docs/domain/journal.md 1.1「起票者」)。必須、未指定では仕訳を作成できない */
  householdMemberId: number
  lines: JournalLineInput[]
  /**
   * この仕訳をfrom_entryとして同時に作成するjournal_entry_links(docs/domain/journal.md 1.8)。
   * 消込(settles)仕訳の作成とリンクの作成を単一のDBトランザクションで行うためのもの
   * (docs/domain/reconciliation.md 2.3)。settlesハード検証(docs/domain/settlement.md 1.8)に
   * 失敗した場合、仕訳・明細・リンクのいずれも書き込まれない。
   */
  links?: JournalEntryLinkTarget[]
  /**
   * 外部明細取込(docs/domain/statement-import.md 1.5 手順7)の場合、この仕訳と同一DBトランザクション
   * で書き込むexternal_transaction_refs(docs/domain/reconciliation.md 2章)のスナップショット。
   * journalEntryIdは仕訳作成後に確定するため含めない。
   */
  externalTransactionRef?: CreateExternalTransactionRefTarget
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
  lines: JournalLineInput[]
}
