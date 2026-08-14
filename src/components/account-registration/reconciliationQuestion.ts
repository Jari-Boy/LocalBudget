/**
 * 「外部明細と自動で突合するか」(is_reconcilable相当)を専門用語なしで尋ねる将来の設問の
 * 回答候補(計画Issue #92)。将来の科目作成UI拡張(負債(ローン・立替金)の新規作成画面、
 * 計画Issue #92背景4)がこの型を再利用して設問UIを実装する想定の土台であり、本Issueでは
 * 実際の設問UIは追加しない(既存のAccountRegistrationWizardのkind選択・
 * CreditCardRegistrationWizardの固定is_reconcilable = falseという実装・UXは変更しない)。
 * 収益・費用の科目作成では使わない(is_reconcilableが常にnull固定のため、計画Issue #92背景4参照)。
 *
 * accountKind.tsのdetermineIsReconcilable(AccountKind)との違い: あちらは既存の口座登録
 * ウィザードの「種類」選択(bank/cash/e_money/investment)からis_reconcilableを自動決定する
 * 現行ロジックであり、ユーザーに直接「突合するか」を尋ねてはいない。こちらは将来、
 * 種類選択という形を取らない科目(ローン・立替金等)向けに、この設問そのものを
 * 専門用語なしで直接尋ねるための回答候補を表す。
 *
 * 設問文言の置き場所: 実際に設問UIを追加するIssueで、`src/locales/ja/account.json`に
 * 文言キー(例: `reconciliationQuestionLabel`)を追加し、上記の意図(「外部明細と自動で
 * 突合するか」を専門用語なしで表現する文言)に沿って文言を確定する。
 */
export type ReconciliationAnswer = 'matches_external_statement' | 'manual_only'

/**
 * 設問への回答をis_reconcilable相当のboolean値に変換する。
 */
export function reconciliationAnswerToIsReconcilable(answer: ReconciliationAnswer): boolean {
  return answer === 'matches_external_statement'
}
