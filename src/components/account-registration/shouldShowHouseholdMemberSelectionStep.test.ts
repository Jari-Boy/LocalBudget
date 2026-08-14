/**
 * shouldShowHouseholdMemberSelectionStep(名義選択ステップの表示要否判定、計画Issue #92)の
 * ユニットテスト。「世帯メンバー0件なら常に非表示」「isApplicableがtrueかつ世帯メンバーが
 * 1件以上なら表示」という表示要否のみの判定を検証する。必須/任意の切り替え(計画Issue #102)は
 * この関数の責務外(HouseholdMemberSelectionStep側の`unspecifiedOptionLabel`で表現する)。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { shouldShowHouseholdMemberSelectionStep } from './shouldShowHouseholdMemberSelectionStep'

function makeMember(id: number, name: string): HouseholdMember {
  return { id, name, isGroup: false, isActive: true, createdAt: '2026-08-13', updatedAt: '2026-08-13' }
}

describe('shouldShowHouseholdMemberSelectionStep', () => {
  it('世帯メンバーが0件の場合、isApplicableの値に関わらずfalseを返す', () => {
    expect(shouldShowHouseholdMemberSelectionStep([], true)).toBe(false)
    expect(shouldShowHouseholdMemberSelectionStep([], false)).toBe(false)
  })

  it('世帯メンバーが1件以上でもisApplicableがfalseの場合、falseを返す(このステップが概念として存在しない場合)', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')], false)).toBe(false)
  })

  it('世帯メンバーが1件以上でisApplicableがtrueの場合、trueを返す', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')], true)).toBe(true)
  })

  it('isApplicableを省略した場合、既定値のtrue(このステップが概念として常に存在する呼び出し元向け)として扱われる', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')])).toBe(true)
  })
})
