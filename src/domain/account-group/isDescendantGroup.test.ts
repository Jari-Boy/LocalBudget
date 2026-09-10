/**
 * isDescendantGroup(循環参照検証の純粋関数)のユニットテスト。
 * docs/domain/accounts.md 3.3節「親グループの変更時、新しい親が自分自身の子孫でないことを
 * 検証する」という循環参照防止の判定ロジックを、直接の親子・多階層(祖父母-孫)・自己参照・
 * 無関係なグループ・逆方向(祖先を親に指定するケース)の各パターンで検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { AccountGroup } from './AccountGroup'
import { isDescendantGroup } from './isDescendantGroup'

function buildGroup(overrides: Partial<AccountGroup> = {}): AccountGroup {
  return {
    id: 1,
    name: 'テストグループ',
    parentGroupId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isDescendantGroup', () => {
  it('候補の親が対象グループの直接の子である場合、循環参照として検出する', () => {
    const parent = buildGroup({ id: 1 })
    const child = buildGroup({ id: 2, parentGroupId: 1 })

    expect(isDescendantGroup([parent, child], 1, 2)).toBe(true)
  })

  it('候補の親が対象グループの孫(多階層)である場合も循環参照として検出する', () => {
    const grandparent = buildGroup({ id: 1 })
    const parent = buildGroup({ id: 2, parentGroupId: 1 })
    const grandchild = buildGroup({ id: 3, parentGroupId: 2 })

    expect(isDescendantGroup([grandparent, parent, grandchild], 1, 3)).toBe(true)
  })

  it('候補の親が自分自身である場合(自己参照)も循環参照として検出する', () => {
    const group = buildGroup({ id: 1 })

    expect(isDescendantGroup([group], 1, 1)).toBe(true)
  })

  it('候補の親が対象グループの子孫ではない無関係なグループである場合はfalseを返す', () => {
    const groupA = buildGroup({ id: 1 })
    const groupB = buildGroup({ id: 2 })

    expect(isDescendantGroup([groupA, groupB], 1, 2)).toBe(false)
  })

  it('候補の親が対象グループの祖先(逆方向)である場合はfalseを返す', () => {
    const parent = buildGroup({ id: 1 })
    const child = buildGroup({ id: 2, parentGroupId: 1 })

    expect(isDescendantGroup([parent, child], 2, 1)).toBe(false)
  })
})
