import type { Account } from '../account/Account'

export interface HouseholdMemberAssignableLine {
  accountId: number
  householdMemberId: number | null
}

/**
 * 実効メンバーの解決(docs/domain/household-members.md 1.2節)。
 * 実効メンバー = COALESCE(journal_lines.household_member_id, accounts.household_member_id)。
 * 明細側の指定は口座の既定値に対する例外的な上書きであり、未設定(null)なら口座の既定値を継承する。
 * DB非依存の純粋関数。
 */
export function resolveEffectiveHouseholdMemberId(
  line: HouseholdMemberAssignableLine,
  accountsById: ReadonlyMap<number, Account>,
): number | null {
  if (line.householdMemberId !== null) {
    return line.householdMemberId
  }

  return accountsById.get(line.accountId)?.householdMemberId ?? null
}
