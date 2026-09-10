/**
 * flattenAccountGroupTree(グループの入れ子構造を表示順・深さ付きのフラットリストに
 * 変換する純粋関数)のユニットテスト。docs/domain/accounts.md 3.3節の入れ子構造
 * (parent_group_idによる多階層)を、展開/折りたたみ式ツリーではなく深さに応じた
 * インデント付きフラットリストで表現するという方針(計画Issue #112)に基づく。
 * 最上位グループが複数ある場合・多階層(祖父母-孫)・子が複数ある場合の並び順と
 * 深さを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { AccountGroup } from './AccountGroup'
import { flattenAccountGroupTree } from './flattenAccountGroupTree'

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

describe('flattenAccountGroupTree', () => {
  it('最上位グループのみの場合は全て深さ0で返す', () => {
    const a = buildGroup({ id: 1, name: '固定費' })
    const b = buildGroup({ id: 2, name: '変動費' })

    const result = flattenAccountGroupTree([a, b])

    expect(result).toEqual([
      { group: a, depth: 0 },
      { group: b, depth: 0 },
    ])
  })

  it('子グループは親の直後に深さ+1で並ぶ', () => {
    const parent = buildGroup({ id: 1, name: '固定費' })
    const child = buildGroup({ id: 2, name: 'クレジットカード', parentGroupId: 1 })

    const result = flattenAccountGroupTree([parent, child])

    expect(result).toEqual([
      { group: parent, depth: 0 },
      { group: child, depth: 1 },
    ])
  })

  it('多階層(祖父母-親-子)の深さが正しく計算される', () => {
    const grandparent = buildGroup({ id: 1, name: '固定費' })
    const parent = buildGroup({ id: 2, name: 'クレジットカード', parentGroupId: 1 })
    const grandchild = buildGroup({ id: 3, name: '楽天カード', parentGroupId: 2 })

    const result = flattenAccountGroupTree([grandparent, parent, grandchild])

    expect(result.map((node) => node.depth)).toEqual([0, 1, 2])
  })

  it('同じ親を持つ複数の子グループは元の並び順を維持する', () => {
    const parent = buildGroup({ id: 1, name: '固定費' })
    const child1 = buildGroup({ id: 2, name: 'クレジットカード', parentGroupId: 1 })
    const child2 = buildGroup({ id: 3, name: '通信費', parentGroupId: 1 })

    const result = flattenAccountGroupTree([parent, child1, child2])

    expect(result.map((node) => node.group.id)).toEqual([1, 2, 3])
  })
})
