/**
 * computeTreeNodeUpdates(計画Issue #154)のテスト。
 * ツリー表で移動した結果(移動前後のノード配列)から、DBへ書き戻す差分(親グループと同じ入れ物の
 * 中での並び順)を求める純粋関数を検証する。移動の影響を受けた入れ物(移動元・移動先)の兄弟は
 * 並び順を0からの連番に振り直し、現在の値と違うノードだけを返すこと、影響を受けない入れ物は
 * 触らないことを確認する。科目・取引先・プロジェクトで共通に使うため汎用ノード型だけを扱い、
 * DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import { computeTreeNodeUpdates } from './computeTreeNodeUpdates'
import { resolveTreeMove, type TreeTableNode } from './treeTableModel'

function node(id: string, parentId: string | null, kind: 'group' | 'leaf' = 'leaf'): TreeTableNode {
  return { id, kind, category: 'asset', parentId, name: id, cells: [] }
}

/** 並び順がすべて連番(0,1,2...)の状態を、入れ物ごとに作る */
function sequentialOrders(nodes: TreeTableNode[]): Map<string, number> {
  const counters = new Map<string, number>()
  const orders = new Map<string, number>()
  for (const n of nodes) {
    const key = `${n.category}|${n.parentId}`
    const order = counters.get(key) ?? 0
    orders.set(n.id, order)
    counters.set(key, order + 1)
  }
  return orders
}

describe('computeTreeNodeUpdates', () => {
  it('移動が無ければ、差分は空になる', () => {
    const nodes = [node('g1', null, 'group'), node('a1', 'g1'), node('a2', 'g1')]

    expect(computeTreeNodeUpdates(nodes, nodes, sequentialOrders(nodes))).toEqual([])
  })

  it('グループの中へ移動すると、親が変わり、移動先の末尾の並び順になる', () => {
    const nodes = [node('g1', null, 'group'), node('a1', 'g1'), node('a2', null)]
    const moved = resolveTreeMove(nodes, ['a2'], { id: 'g1', zone: 'inside' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, sequentialOrders(nodes))

    expect(updates).toEqual([{ id: 'a2', parentId: 'g1', sortOrder: 1 }])
  })

  it('同じ入れ物の中で並び替えると、入れ替わった兄弟の並び順だけが変わる', () => {
    const nodes = [node('a1', null), node('a2', null), node('a3', null)]
    const moved = resolveTreeMove(nodes, ['a3'], { id: 'a1', zone: 'before' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, sequentialOrders(nodes))

    expect(updates).toEqual([
      { id: 'a3', parentId: null, sortOrder: 0 },
      { id: 'a1', parentId: null, sortOrder: 1 },
      { id: 'a2', parentId: null, sortOrder: 2 },
    ])
  })

  it('移動元の入れ物に残った兄弟は、抜けた分だけ並び順を詰める', () => {
    const nodes = [node('g1', null, 'group'), node('a1', 'g1'), node('a2', 'g1'), node('a3', 'g1')]
    const moved = resolveTreeMove(nodes, ['a1'], { id: 'cat:asset', zone: 'inside' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, sequentialOrders(nodes))

    expect(updates).toContainEqual({ id: 'a2', parentId: 'g1', sortOrder: 0 })
    expect(updates).toContainEqual({ id: 'a3', parentId: 'g1', sortOrder: 1 })
    expect(updates).toContainEqual({ id: 'a1', parentId: null, sortOrder: 1 })
  })

  it('複数まとめて移動すると、すべての移動対象が移動先に並び順どおり入る', () => {
    const nodes = [node('g1', null, 'group'), node('a1', null), node('a2', null)]
    const moved = resolveTreeMove(nodes, ['a1', 'a2'], { id: 'g1', zone: 'inside' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, sequentialOrders(nodes))

    expect(updates).toEqual([
      { id: 'a1', parentId: 'g1', sortOrder: 0 },
      { id: 'a2', parentId: 'g1', sortOrder: 1 },
    ])
  })

  it('影響を受けない入れ物の兄弟は、並び順が重複していても触らない', () => {
    const nodes = [
      node('g1', null, 'group'),
      node('g2', null, 'group'),
      node('b1', 'g2'),
      node('b2', 'g2'),
      node('a1', null),
    ]
    const orders = sequentialOrders(nodes)
    orders.set('b1', 5)
    orders.set('b2', 5)
    const moved = resolveTreeMove(nodes, ['a1'], { id: 'g1', zone: 'inside' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, orders)

    expect(updates.map((u) => u.id)).not.toContain('b1')
    expect(updates.map((u) => u.id)).not.toContain('b2')
  })

  it('並び順が重複していた移動先の兄弟は、連番に振り直す', () => {
    const nodes = [node('g1', null, 'group'), node('a1', 'g1'), node('a2', 'g1'), node('a3', null)]
    const orders = sequentialOrders(nodes)
    orders.set('a1', 0)
    orders.set('a2', 0)
    const moved = resolveTreeMove(nodes, ['a3'], { id: 'g1', zone: 'inside' })
    if (!moved.ok) throw new Error('移動に失敗')

    const updates = computeTreeNodeUpdates(nodes, moved.nodes, orders)

    expect(updates).toContainEqual({ id: 'a2', parentId: 'g1', sortOrder: 1 })
    expect(updates).toContainEqual({ id: 'a3', parentId: 'g1', sortOrder: 2 })
  })
})
