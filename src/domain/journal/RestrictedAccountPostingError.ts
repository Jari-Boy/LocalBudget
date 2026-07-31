/**
 * is_reconcilable = trueの科目(銀行口座・電子マネー・証券口座等)を借方/貸方に使う仕訳明細を
 * 含む仕訳を、source_typeがホワイトリスト(external_import/initial_balance/balance_adjustment)
 * 外の経路で作成しようとした場合にスローされるドメインエラー(docs/domain/reconciliation.md 1.2)。
 * 貸借バランス検証(UnbalancedJournalEntryError)とは無関係な別の業務ルールであるため、
 * 呼び出し側がinstanceofで両者を区別できるよう専用の型として新設した(docs/decisions.md参照)。
 */
export class RestrictedAccountPostingError extends Error {
  readonly accountId: number
  readonly sourceType: string

  constructor(accountId: number, sourceType: string) {
    super(
      `cannot post to is_reconcilable account (accountId=${accountId}) with sourceType=${sourceType}; ` +
        `only external_import/initial_balance/balance_adjustment are allowed`,
    )
    this.name = 'RestrictedAccountPostingError'
    this.accountId = accountId
    this.sourceType = sourceType
  }
}
