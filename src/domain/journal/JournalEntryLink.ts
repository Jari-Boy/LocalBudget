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

/**
 * CreateJournalEntryInput.linksに渡す、作成する仕訳自身をfrom_entryとする関係の入力
 * (docs/domain/journal.md 1.8)。fromEntryIdは仕訳作成後に採番されたIDを使うため持たない。
 */
export interface JournalEntryLinkTarget {
  toEntryId: number
  linkType: JournalEntryLinkType
  amount: number
}
