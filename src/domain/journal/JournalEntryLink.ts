export type JournalEntryLinkType = 'settles' | 'allocates'

export interface JournalEntryLink {
  id: number
  fromEntryId: number
  toEntryId: number
  linkType: JournalEntryLinkType
  amount: number
  createdAt: string
}

export interface CreateJournalEntryLinkInput {
  fromEntryId: number
  toEntryId: number
  linkType: JournalEntryLinkType
  amount: number
}
