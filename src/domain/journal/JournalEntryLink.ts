export type JournalEntryLinkType = 'settles' | 'allocates'

/**
 * 仕訳明細(journal_lines)同士を結ぶリンク(docs/domain/journal.md 1.8、計画Issue #132)。
 * 消込(settles)・割勘(allocates)はいずれも「from側の明細行がto側の明細行を解消/付け替える」
 * 関係であり、DBには明細行のid(from_line_id・to_line_id)だけを保持する。
 */
export interface JournalEntryLink {
  id: number
  /** 消込・割勘する側(消込仕訳・割勘仕訳)の明細行 */
  fromLineId: number
  /** 消込・割勘される側(元の暫定計上・元の支出)の明細行 */
  toLineId: number
  /**
   * fromLineId・toLineIdが属する仕訳のid。DBには保持せず、journal_linesとのJOINで導出する
   * (仕訳単位のトラバーサルfindLinkedEntries等のため)。
   */
  fromEntryId: number
  toEntryId: number
  linkType: JournalEntryLinkType
  amount: number
  createdAt: string
}

export interface CreateJournalEntryLinkInput {
  fromLineId: number
  toLineId: number
  linkType: JournalEntryLinkType
  amount: number
}

/**
 * CreateJournalEntryInput.linksに渡す、作成する仕訳自身の明細行をfrom_lineとする関係の入力
 * (docs/domain/journal.md 1.8)。from_lineのidは仕訳作成後に採番されるため、
 * CreateJournalEntryInput.lines内の位置(0始まり)で指定する。
 */
export interface JournalEntryLinkTarget {
  fromLineIndex: number
  toLineId: number
  linkType: JournalEntryLinkType
  amount: number
}
