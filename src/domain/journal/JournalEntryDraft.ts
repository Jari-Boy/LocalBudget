import type { JournalLineSide } from './JournalEntry'

export type JournalEntryDraftPurpose = 'manual_entry'

export interface JournalEntryDraftLine {
  id: number
  journalEntryDraftId: number
  accountId: number | null
  projectId: number | null
  householdMemberId: number | null
  counterpartyId: number | null
  side: JournalLineSide | null
  amount: number | null
  createdAt: string
}

export interface JournalEntryDraft {
  id: number
  purpose: JournalEntryDraftPurpose
  entryDate: string | null
  memo: string | null
  currency: string | null
  /** 起票者(journal_entries.householdMemberId相当)。下書き段階では未入力を許容するためnull可 */
  householdMemberId: number | null
  createdAt: string
  updatedAt: string
  lines: JournalEntryDraftLine[]
}

export interface JournalEntryDraftLineInput {
  accountId?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  side?: JournalLineSide | null
  amount?: number | null
}

export interface CreateJournalEntryDraftInput {
  purpose?: JournalEntryDraftPurpose
  entryDate?: string | null
  memo?: string | null
  currency?: string | null
  householdMemberId?: number | null
  lines?: JournalEntryDraftLineInput[]
}

export interface UpdateJournalEntryDraftInput {
  entryDate?: string | null
  memo?: string | null
  currency?: string | null
  householdMemberId?: number | null
  lines?: JournalEntryDraftLineInput[]
}
