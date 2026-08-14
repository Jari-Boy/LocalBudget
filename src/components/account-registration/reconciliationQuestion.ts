/**
 * is_reconcilable(照合可否)を「外部明細(CSV)の有無」×「残高情報の有無」という
 * 2軸の設問で決定するロジック(計画Issue #102)。資産・負債の新規登録フローにおいて、
 * 「口座の種類」による特別扱いをせず、この2軸のみでis_reconcilableを一般化して
 * 説明する(docs/domain/accounts.md 4章参照)。
 *
 * - 外部明細(CSV)が無い場合(hasExternalStatement = false): 残高情報の設問はそもそも
 *   問われない(hasBalanceInStatement = null)。例: 現金。
 * - 外部明細はあるが、残高情報が明細に無い場合: false。例: クレジットカード
 *   (利用明細はあるが、残高そのものは明細に現れない)。
 * - 外部明細があり、残高情報も明細にある場合のみ: true。例: 銀行口座。
 *
 * 計画Issue #92で導入された単一設問(matches_external_statement/manual_only)の型を、
 * 計画Issue #102でこの2軸設問へ置き換えた(旧型の唯一の利用箇所だったOtherAccountCreationForm・
 * registerOtherAccountは計画Issue #102で廃止・置き換え済み)。
 */
export interface ReconciliationAnswer {
  /** 外部明細(CSV)が存在するか */
  hasExternalStatement: boolean
  /**
   * 残高情報が明細にあるか。hasExternalStatementがfalseの場合はそもそも
   * 問われない設問のためnull。
   */
  hasBalanceInStatement: boolean | null
}

/**
 * 2軸の設問への回答をis_reconcilable相当のboolean値に変換する。
 * 「外部明細があり、かつ残高情報も明細にある」場合のみtrue。
 */
export function reconciliationAnswerToIsReconcilable(answer: ReconciliationAnswer): boolean {
  return answer.hasExternalStatement && answer.hasBalanceInStatement === true
}
