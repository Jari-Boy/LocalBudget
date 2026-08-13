import type { Account } from '../account/Account'

export interface HouseholdMemberAssignableLine {
  accountId: number
  householdMemberId: number | null
}

/**
 * 実効メンバーの解決(docs/domain/household-members.md 1.2節、計画Issue #88で改訂)。
 * 科目に既定値(accounts.household_member_id)があれば明細側の指定によらずそれを強制する
 * (口座の名義は口座に固定される性質のため、DDLトリガー(docs/schema/journal.sql)が
 * 明細側での上書きを禁止しており、明細側は常にnullか科目の既定値と同じ値しか持たない)。
 * 科目に既定値が無い場合のみ明細側の指定(上書き)が有効になり、明細側もnullなら
 * 仕訳ヘッダーの起票者(journal_entries.household_member_id、NOT NULL)にフォールバックする。
 * 起票者は必ず非nullのため、本関数の返り値も常に非nullになる。
 * DB非依存の純粋関数。
 */
export function resolveEffectiveHouseholdMemberId(
  line: HouseholdMemberAssignableLine,
  accountsById: ReadonlyMap<number, Account>,
  entryHouseholdMemberId: number,
): number {
  const accountDefault = accountsById.get(line.accountId)?.householdMemberId ?? null
  if (accountDefault !== null) {
    return accountDefault
  }

  return line.householdMemberId ?? entryHouseholdMemberId
}
