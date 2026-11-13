import type { Account } from './Account'

/**
 * 科目が外部明細(CSV)を持つか(計画Issue #189)。登録時の回答(has_external_statement)をそのまま返し、
 * 回答を保存する前に作られた行(null)は、照合可否から推定する(照合する科目は外部明細あり、それ以外はなし)。
 * 外部明細の有無は、明細マッピングの紐づけ先・明細取込の取込先になれるかの判定に使う。
 */
export function resolveHasExternalStatement(
  account: Pick<Account, 'hasExternalStatement' | 'isReconcilable'>,
): boolean {
  return account.hasExternalStatement ?? account.isReconcilable === true
}
