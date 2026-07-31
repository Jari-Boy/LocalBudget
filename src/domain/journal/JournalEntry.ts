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
  lines: JournalLineInput[]
  /**
   * この仕訳をfrom_entryとして同時に作成するjournal_entry_links(docs/domain/journal.md 1.8)。
   * 消込(settles)仕訳の作成とリンクの作成を単一のDBトランザクションで行うためのもの
   * (docs/domain/reconciliation.md 2.3)。settlesハード検証(docs/domain/settlement.md 1.8)に
   * 失敗した場合、仕訳・明細・リンクのいずれも書き込まれない。
   */
  links?: JournalEntryLinkTarget[]
}

export interface UpdateJournalEntryInput {
  entryDate: string
  memo?: string | null
  lines: JournalLineInput[]
}
