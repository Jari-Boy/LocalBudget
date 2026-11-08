/**
 * 割勘の一時勘定(システム管理の立替金・未払金)ではない科目の明細行に、精算バッチのタグ
 * (settlement_batch_id)を設定しようとした場合にスローされるドメインエラー(計画Issue #144・#167)。
 * 貸借バランス(UnbalancedJournalEntryError)とは別の業務ルールであるため、
 * 呼び出し側がinstanceofで区別できる専用の型とした。
 */
export class SettlementBatchOnNonAdvanceAccountError extends Error {
  readonly accountId: number

  constructor(accountId: number) {
    super(
      `settlement batch can only be set on advance account lines ` +
        `(system-managed asset/liability); accountId=${accountId}`,
    )
    this.name = 'SettlementBatchOnNonAdvanceAccountError'
    this.accountId = accountId
  }
}
