/**
 * resolveLineHouseholdMemberId / createLineHouseholdMemberResolver のテスト(計画Issue #169)。
 * 明細行に保存する世帯メンバーの決め方(科目の既定メンバー > 指定されたメンバー > 起票者)を検証する。
 * 明細行は常に実際の世帯メンバーを持つため、書き込み側がこの関数で必ず1人に確定してから保存する。
 * 外部依存なしの純粋関数のテスト。
 */
import { describe, expect, it } from 'vitest'
import { createLineHouseholdMemberResolver, resolveLineHouseholdMemberId } from './resolveLineHouseholdMemberId'

describe('resolveLineHouseholdMemberId', () => {
  it('科目に既定の世帯メンバーがあれば、指定や起票者によらずその既定値になる(上書き不可)', () => {
    expect(resolveLineHouseholdMemberId({ accountDefault: 1, requested: 2, entryMemberId: 3 })).toBe(1)
  })

  it('科目に既定値が無く指定があれば、指定した世帯メンバーになる', () => {
    expect(resolveLineHouseholdMemberId({ accountDefault: null, requested: 2, entryMemberId: 3 })).toBe(2)
  })

  it('科目に既定値も指定も無ければ、起票者になる(入力時の既定値)', () => {
    expect(resolveLineHouseholdMemberId({ accountDefault: null, requested: null, entryMemberId: 3 })).toBe(3)
    expect(resolveLineHouseholdMemberId({ accountDefault: null, requested: undefined, entryMemberId: 3 })).toBe(3)
  })
})

describe('createLineHouseholdMemberResolver', () => {
  const accounts = [
    { id: 10, householdMemberId: 1 },
    { id: 20, householdMemberId: null },
  ]

  it('科目idから既定値を引いて、行ごとの世帯メンバーを決める関数を返す', () => {
    const resolve = createLineHouseholdMemberResolver(accounts, 3)
    expect(resolve(10)).toBe(1)
    expect(resolve(10, 2)).toBe(1)
    expect(resolve(20, 2)).toBe(2)
    expect(resolve(20)).toBe(3)
  })

  it('一覧にない科目は既定値なしとして扱う', () => {
    expect(createLineHouseholdMemberResolver(accounts, 3)(999)).toBe(3)
  })
})
