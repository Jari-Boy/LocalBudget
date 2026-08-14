import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'

/**
 * 名義(世帯メンバー)選択ステップを表示するかどうか(docs/domain/accounts.md 4.1節・5.1節)。
 * isApplicableはウィザードごとに異なる「このステップが概念として存在するか」の判定
 * (口座登録: kindに応じたrequiresHouseholdMemberSelection、クレジットカード登録: 常にtrue)を
 * 呼び出し側から渡す。世帯メンバーが1人も登録されていない場合は、isApplicableの値に
 * 関わらず選択肢が無いためステップ自体を表示しない。表示される場合は常に必須(「世帯共通」の
 * 選択肢は無い、計画Issue #90)であり、表示要否と必須要否は同一の判定に一致する。
 */
export function shouldShowHouseholdMemberSelectionStep(
  householdMembers: HouseholdMember[],
  isApplicable: boolean = true,
): boolean {
  return isApplicable && householdMembers.length > 0
}
