import type { Account } from './Account'
import { resolveHasExternalStatement } from './resolveHasExternalStatement'

/** 資産・負債科目の「登録時の設定」(計画Issue #189)。画面には表示のみで、あとから変更しない */
export interface AccountRegistrationSummary {
  /**
   * 外部明細(CSV)の有無。登録時の回答(has_external_statement)を返す。回答を保存する前に
   * 作られた行(null)は、照合可否から推定する(照合する科目は外部明細あり、それ以外はなし)
   */
  hasExternalStatement: boolean
  /**
   * 残高情報の有無。is_reconcilableがtrue(外部明細あり かつ 残高情報あり)のときだけtrue
   * (docs/domain/accounts.md 4.2)
   */
  hasBalanceInfo: boolean
}

/**
 * 資産・負債科目の登録時の設定を、科目から求める。資産・負債以外はnull(対象外)。
 * 初期残高は「最初の基準点」として残高の照合欄に統合した(計画Issue #205)。
 */
export function summarizeAccountRegistration(account: Account): AccountRegistrationSummary | null {
  if (account.category !== 'asset' && account.category !== 'liability') return null

  return {
    hasExternalStatement: resolveHasExternalStatement(account),
    hasBalanceInfo: account.isReconcilable === true,
  }
}
