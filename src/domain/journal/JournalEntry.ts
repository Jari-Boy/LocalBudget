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
}

export interface UpdateJournalEntryInput {
  entryDate: string
  memo?: string | null
  lines: JournalLineInput[]
}
