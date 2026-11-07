/**
 * expandGroupIds(指定したグループと、その配下(入れ子を含む)のグループのid集合を返す純粋関数、
 * 計画Issue #145)のユニットテスト。勘定科目・取引先・プロジェクトの3種類のグループで共用する
 * (GroupNode)。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { expandGroupIds } from './expandGroupIds'

const GROUPS = [
  { id: 1, parentGroupId: null },
  { id: 2, parentGroupId: 1 },
  { id: 3, parentGroupId: 2 },
  { id: 4, parentGroupId: 1 },
  { id: 5, parentGroupId: null },
]

describe('expandGroupIds', () => {
  it('指定したグループ自身と、配下のグループを入れ子の深さによらずすべて含める', () => {
    expect([...expandGroupIds(GROUPS, [1])].sort()).toEqual([1, 2, 3, 4])
  })

  it('子を持たないグループは自身だけを返す', () => {
    expect([...expandGroupIds(GROUPS, [3])]).toEqual([3])
  })

  it('複数のグループを指定すると、それぞれの配下の和集合を返す', () => {
    expect([...expandGroupIds(GROUPS, [2, 5])].sort()).toEqual([2, 3, 5])
  })

  it('グループ一覧に存在しないidも、そのidだけを返す(配下は無い)', () => {
    expect([...expandGroupIds(GROUPS, [99])]).toEqual([99])
  })

  it('何も指定しなければ空集合を返す', () => {
    expect(expandGroupIds(GROUPS, []).size).toBe(0)
  })
})
