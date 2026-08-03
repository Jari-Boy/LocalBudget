/**
 * 口座登録ウィザードの「種類」選択肢(docs/domain/accounts.md 4章)。
 * ドメイン層のAccountCategory('asset'等)とは別に、ウィザードのUI上でのみ
 * 意味を持つ分類であるため、コンポーネント層に配置する。
 */
export type AccountKind = 'bank' | 'cash' | 'e_money' | 'investment'

/**
 * 種類選択によるis_reconcilable(照合可否)の自動決定(docs/domain/accounts.md 4.2節)。
 * 銀行口座/電子マネー/証券・投資口座はtrue(CSV明細の取込・突合が使える)、
 * 現金はfalse(実残調整機能を使う)。
 */
export function determineIsReconcilable(kind: AccountKind): boolean {
  return kind !== 'cash'
}
