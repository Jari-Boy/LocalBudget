import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'

/**
 * 名義(世帯メンバー)選択ステップを表示するかどうか(docs/domain/accounts.md 4.1節・5.1節)。
 * isApplicableは呼び出し元ごとに異なる「このステップが概念として存在するか」の判定
 * (統合フロー`AccountRegistrationFlow`では常にtrue、資産・負債選択後は外部明細の有無に
 * 関わらず名義選択ステップ自体は存在する)を呼び出し側から渡す。世帯メンバーが1人も
 * 登録されていない場合は、isApplicableの値に関わらず選択肢が無いためステップ自体を
 * 表示しない。
 *
 * 表示要否(この関数の責務)と必須要否は別の判定である点に注意(計画Issue #102で分離)。
 * 外部明細ありの場合は表示される場合は常に必須(「全員」の選択肢は無い、計画Issue #90)だが、
 * 外部明細なしの場合は表示されても任意選択(`HouseholdMemberSelectionStep`の
 * `unspecifiedOptionLabel`で「全員」を選べる)になりうる。必須/任意の切り替えは
 * 呼び出し元(`AccountRegistrationFlow`)がこの関数の戻り値とは別に判定する。
 */
export function shouldShowHouseholdMemberSelectionStep(
  householdMembers: HouseholdMember[],
  isApplicable: boolean = true,
): boolean {
  return isApplicable && householdMembers.length > 0
}
