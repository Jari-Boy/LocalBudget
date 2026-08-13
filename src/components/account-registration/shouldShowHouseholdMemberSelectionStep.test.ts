/**
 * shouldShowHouseholdMemberSelectionStep(名義選択ステップの表示要否判定、計画Issue #92)の
 * ユニットテスト。docs/domain/accounts.md 4.1節・5.1節が定める
 * 「世帯メンバー0件なら常に非表示」「表示される場合は常に必須」という判定を検証する。
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

  it('世帯メンバーが1件以上でisApplicableがfalseの場合、falseを返す(例:現金のkind、4.1節)', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')], false)).toBe(false)
  })

  it('世帯メンバーが1件以上でisApplicableがtrueの場合、trueを返す', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')], true)).toBe(true)
  })

  it('isApplicableを省略した場合、常に必須(クレジットカード登録ウィザード、5.1節)としてtrueを返す', () => {
    expect(shouldShowHouseholdMemberSelectionStep([makeMember(1, '太郎')])).toBe(true)
  })
})
