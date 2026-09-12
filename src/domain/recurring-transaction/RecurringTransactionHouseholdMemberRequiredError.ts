/**
 * 定期取引の提案確認(confirm)時、起票者(journal_entries.household_member_id)を解決できな
 * かった場合にスローされるドメインエラー。ルール自体のhouseholdMemberId(明細の上書き用、
 * docs/domain/recurring-transactions.md 1.4節)は任意のため、ルールが未設定かつ呼び出し側も
 * 指定しなかった場合に発生する。呼び出し側はinstanceofで判定し、起票者の選択を促すUIを
 * 表示できる。
 */
export class RecurringTransactionHouseholdMemberRequiredError extends Error {
  readonly ruleId: number

  constructor(ruleId: number) {
    super(
      `recurring transaction rule ${ruleId} has no householdMemberId; a bookkeeper householdMemberId must be provided to confirm a proposal`,
    )
    this.name = 'RecurringTransactionHouseholdMemberRequiredError'
    this.ruleId = ruleId
  }
}
