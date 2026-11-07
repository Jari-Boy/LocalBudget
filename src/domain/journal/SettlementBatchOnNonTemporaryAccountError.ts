/**
 * 一時勘定(is_reconcilable = falseの資産・負債科目)ではない科目の明細行に、精算バッチのタグ
 * (settlement_batch_id)を設定しようとした場合にスローされるドメインエラー(計画Issue #144)。
 * 貸借バランス(UnbalancedJournalEntryError)とは別の業務ルールであるため、
 * 呼び出し側がinstanceofで区別できる専用の型とした。
 */
export class SettlementBatchOnNonTemporaryAccountError extends Error {
  readonly accountId: number

  constructor(accountId: number) {
    super(
      `settlement batch can only be set on temporary account lines ` +
        `(is_reconcilable = false asset/liability); accountId=${accountId}`,
    )
    this.name = 'SettlementBatchOnNonTemporaryAccountError'
    this.accountId = accountId
  }
}
