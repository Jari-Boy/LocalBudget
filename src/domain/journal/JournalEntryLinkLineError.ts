export type JournalEntryLinkLineErrorReason =
  | 'line_not_found'
  | 'account_mismatch'
  | 'side_not_opposite'
  | 'amount_exceeds_from_line'

/**
 * journal_entry_linksを作成する際、from_line・to_lineの組み合わせが行単位の検証
 * (docs/domain/journal.md 1.8、docs/domain/settlement.md 1.8、計画Issue #132)を満たさない場合に
 * スローされるドメインエラー。settlesリンクの科目・タグ不一致はSettlementTagMismatchErrorが
 * 担当し、本エラーは行が存在しない・allocatesリンクの科目不一致・貸借が逆でない・from_lineの
 * 金額上限超過を扱う。
 */
export class JournalEntryLinkLineError extends Error {
  readonly reason: JournalEntryLinkLineErrorReason
  readonly fromLineId: number | null
  readonly toLineId: number

  constructor(reason: JournalEntryLinkLineErrorReason, fromLineId: number | null, toLineId: number) {
    super(
      `invalid journal entry link (${reason}): fromLineId=${fromLineId ?? 'unknown'}, toLineId=${toLineId}`,
    )
    this.name = 'JournalEntryLinkLineError'
    this.reason = reason
    this.fromLineId = fromLineId
    this.toLineId = toLineId
  }
}
