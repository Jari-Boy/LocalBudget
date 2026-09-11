/**
 * buildAccountGroupPathLabels(グループの入れ子構造から「親 > 子」形式の
 * パス表示ラベルを組み立てる純粋関数)のユニットテスト。異なる親グループの下に
 * 同名のグループが存在する場合、選択肢一覧(<select>)上でグループ名だけでは
 * 区別できないという実運用上の問題(ユーザー指摘)に対応するため、フラットな
 * <select>の選択肢表示にはこのパス表示を用いる。最上位グループ・多階層・
 * 同名グループの区別可否を検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { AccountGroup } from './AccountGroup'
import { buildAccountGroupPathLabels } from './buildAccountGroupPathLabels'

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

describe('buildAccountGroupPathLabels', () => {
  it('最上位グループはグループ名そのものをラベルとする', () => {
    const group = buildGroup({ id: 1, name: '固定費' })

    const labels = buildAccountGroupPathLabels([group])

    expect(labels.get(1)).toBe('固定費')
  })

  it('子グループは「親 > 子」の形式のラベルになる', () => {
    const parent = buildGroup({ id: 1, name: '固定費' })
    const child = buildGroup({ id: 2, name: 'カード', parentGroupId: 1 })

    const labels = buildAccountGroupPathLabels([parent, child])

    expect(labels.get(2)).toBe('固定費 > カード')
  })

  it('多階層(祖父母-親-子)のラベルは全階層を連結する', () => {
    const grandparent = buildGroup({ id: 1, name: '固定費' })
    const parent = buildGroup({ id: 2, name: 'クレジットカード', parentGroupId: 1 })
    const grandchild = buildGroup({ id: 3, name: '楽天カード', parentGroupId: 2 })

    const labels = buildAccountGroupPathLabels([grandparent, parent, grandchild])

    expect(labels.get(3)).toBe('固定費 > クレジットカード > 楽天カード')
  })

  it('異なる親配下の同名グループは異なるラベルになり区別できる', () => {
    const fixedCost = buildGroup({ id: 1, name: '固定費' })
    const variableCost = buildGroup({ id: 2, name: '変動費' })
    const cardUnderFixed = buildGroup({ id: 3, name: 'カード', parentGroupId: 1 })
    const cardUnderVariable = buildGroup({ id: 4, name: 'カード', parentGroupId: 2 })

    const labels = buildAccountGroupPathLabels([
      fixedCost,
      variableCost,
      cardUnderFixed,
      cardUnderVariable,
    ])

    expect(labels.get(3)).toBe('固定費 > カード')
    expect(labels.get(4)).toBe('変動費 > カード')
    expect(labels.get(3)).not.toBe(labels.get(4))
  })
})
