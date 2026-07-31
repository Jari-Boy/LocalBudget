/**
 * settlesリンク(消込)を作成する際、消込仕訳(from_entry)側に、消し込まれる元仕訳(to_entry)側の
 * 一時勘定行と同じaccount_id/project_id/household_member_idを持ち、amountが
 * リンクのamount以上の行が存在しない場合にスローされるドメインエラー
 * (docs/domain/settlement.md 1.8「作成時のRepository層ハード検証」)。
 */
export class SettlementTagMismatchError extends Error {
  readonly fromEntryId: number
  readonly toEntryId: number

  constructor(fromEntryId: number, toEntryId: number) {
    super(
      `settles link requires a matching temporary account line (same account/project/household member, amount >= link amount) ` +
        `in the settling entry (fromEntryId=${fromEntryId}) that corresponds to a temporary account line in the settled entry (toEntryId=${toEntryId})`,
    )
    this.name = 'SettlementTagMismatchError'
    this.fromEntryId = fromEntryId
    this.toEntryId = toEntryId
  }
}
