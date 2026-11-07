/**
 * ツリー表(マスタ用)の行の組み立てと移動判定の純粋関数のテスト(計画Issue #150)。
 * 区分の見出し行・入れ子の行・折りたたみ・件数の組み立て、ドロップ位置の判定
 * (行の上端・下端で並び替え、グループの中央で中へ、区分の見出しで最上位へ)、
 * 複数選択の移動、区分またぎ・自分の配下への移動の拒否、移動先の候補を検証する。
 * 外部依存なし(DB・DOMに依存しない。科目・取引先・プロジェクトで共通に使う汎用ノード型のみ)。
 */
import { describe, expect, it } from 'vitest'
import {
  buildTreeTableRows,
  dropZoneFor,
  listMoveDestinations,
  resolveTreeMove,
  type TreeTableNode,
} from './treeTableModel'

const node = (
  id: string,
  kind: 'group' | 'leaf',
  category: string,
  parentId: string | null,
  name = id,
): TreeTableNode => ({ id, kind, category, parentId, name, cells: [] })

const categories = [
  { key: 'expense', name: '費用' },
  { key: 'revenue', name: '収益' },
]

// 費用: 食費(グループ){外食,食料品} / 住居(グループ){光熱費(グループ){電気}} / 雑費 ・ 収益: 給与
const nodes: TreeTableNode[] = [
  node('food', 'group', 'expense', null, '食費'),
  node('eat-out', 'leaf', 'expense', 'food'),
  node('grocery', 'leaf', 'expense', 'food'),
  node('living', 'group', 'expense', null, '住居'),
  node('utility', 'group', 'expense', 'living', '光熱費'),
  node('electric', 'leaf', 'expense', 'utility'),
  node('misc', 'leaf', 'expense', null),
  node('salary', 'leaf', 'revenue', null),
]

const ids = (list: readonly TreeTableNode[]) => list.map((n) => n.id)

describe('buildTreeTableRows', () => {
  it('区分ごとに見出し行を出し、その下に入れ子の行を深さつきで並べる', () => {
    const rows = buildTreeTableRows({ categories, nodes, collapsedIds: new Set() })
    expect(
      rows.map((r) => (r.type === 'category' ? `cat:${r.key}` : `${r.node.id}@${r.depth}`)),
    ).toEqual([
      'cat:expense',
      'food@0',
      'eat-out@1',
      'grocery@1',
      'living@0',
      'utility@1',
      'electric@2',
      'misc@0',
      'cat:revenue',
      'salary@0',
    ])
  })

  it('折りたたんだグループの配下は出さない', () => {
    const rows = buildTreeTableRows({ categories, nodes, collapsedIds: new Set(['living']) })
    const names = rows.filter((r) => r.type === 'node').map((r) => r.node.id)
    expect(names).not.toContain('utility')
    expect(names).not.toContain('electric')
    expect(names).toContain('food')
    const living = rows.find((r) => r.type === 'node' && r.node.id === 'living')
    expect(living && living.type === 'node' && living.isOpen).toBe(false)
  })

  it('件数は区分は直下以下の葉の数、グループは配下(入れ子を含む)の葉の数', () => {
    const rows = buildTreeTableRows({ categories, nodes, collapsedIds: new Set() })
    const expense = rows.find((r) => r.type === 'category' && r.key === 'expense')
    expect(expense && expense.type === 'category' && expense.count).toBe(4)
    const living = rows.find((r) => r.type === 'node' && r.node.id === 'living')
    expect(living && living.type === 'node' && living.leafCount).toBe(1)
  })
})

describe('dropZoneFor', () => {
  it('グループは上端25%で前、下端25%で後ろ、中央で中へ', () => {
    expect(dropZoneFor(true, 0.1)).toBe('before')
    expect(dropZoneFor(true, 0.5)).toBe('inside')
    expect(dropZoneFor(true, 0.9)).toBe('after')
  })

  it('葉は半分で前と後ろに分かれ、中へは入れない', () => {
    expect(dropZoneFor(false, 0.4)).toBe('before')
    expect(dropZoneFor(false, 0.6)).toBe('after')
  })
})

describe('resolveTreeMove', () => {
  it('グループの中へ移すと、親がそのグループになり末尾に入る', () => {
    const result = resolveTreeMove(nodes, ['misc'], { id: 'food', zone: 'inside' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const moved = result.nodes.find((n) => n.id === 'misc')
    expect(moved?.parentId).toBe('food')
    expect(result.expandId).toBe('food')
    expect(ids(result.nodes).indexOf('misc')).toBeGreaterThan(ids(result.nodes).indexOf('grocery'))
  })

  it('行の前・後ろへ移すと、その行と同じ親の兄弟として並ぶ', () => {
    const before = resolveTreeMove(nodes, ['misc'], { id: 'grocery', zone: 'before' })
    expect(before.ok && ids(before.nodes).indexOf('misc')).toBe(ids(nodes).indexOf('grocery'))
    if (before.ok) expect(before.nodes.find((n) => n.id === 'misc')?.parentId).toBe('food')

    const after = resolveTreeMove(nodes, ['eat-out'], { id: 'misc', zone: 'after' })
    expect(after.ok).toBe(true)
    if (after.ok) {
      expect(after.nodes.find((n) => n.id === 'eat-out')?.parentId).toBeNull()
      const order = ids(after.nodes)
      expect(order.indexOf('eat-out')).toBe(order.indexOf('misc') + 1)
    }
  })

  it('区分の見出し(cat:区分)へ移すと、その区分の最上位になる', () => {
    const result = resolveTreeMove(nodes, ['electric'], { id: 'cat:expense', zone: 'inside' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.nodes.find((n) => n.id === 'electric')?.parentId).toBeNull()
      expect(result.expandId).toBeUndefined()
    }
  })

  it('複数選択はまとめて移り、元の相対順を保つ', () => {
    const result = resolveTreeMove(nodes, ['grocery', 'eat-out'], { id: 'living', zone: 'inside' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moved = result.nodes.filter((n) => n.parentId === 'living' && ['eat-out', 'grocery'].includes(n.id))
      expect(ids(moved)).toEqual(['eat-out', 'grocery'])
    }
  })

  it('区分をまたぐ移動は拒否する', () => {
    const result = resolveTreeMove(nodes, ['salary'], { id: 'food', zone: 'inside' })
    expect(result).toEqual({ ok: false, reason: '区分をまたいで移動できません' })
    expect(resolveTreeMove(nodes, ['misc'], { id: 'cat:revenue', zone: 'inside' }).ok).toBe(false)
  })

  it('自分自身や自分の配下への移動は拒否する', () => {
    expect(resolveTreeMove(nodes, ['living'], { id: 'electric', zone: 'inside' })).toEqual({
      ok: false,
      reason: '自分自身の配下には移動できません',
    })
    expect(resolveTreeMove(nodes, ['living'], { id: 'utility', zone: 'before' }).ok).toBe(false)
  })

  it('葉の中へは移動できない', () => {
    expect(resolveTreeMove(nodes, ['misc'], { id: 'eat-out', zone: 'inside' }).ok).toBe(false)
  })

  it('1件だけを自分自身の上へ落としても何も起きない(拒否でも成功でもなく変更なし)', () => {
    const result = resolveTreeMove(nodes, ['misc'], { id: 'misc', zone: 'before' })
    expect(result.ok && result.nodes).toEqual(nodes)
  })

  it('元の配列は書き換えない', () => {
    const snapshot = nodes.map((n) => ({ ...n }))
    resolveTreeMove(nodes, ['misc'], { id: 'food', zone: 'inside' })
    expect(nodes).toEqual(snapshot)
  })
})

describe('listMoveDestinations', () => {
  it('同じ区分のグループと区分の最上位を返し、移動対象とその配下は除く', () => {
    const result = listMoveDestinations(nodes, categories, ['living'])
    expect(result).toEqual([
      { id: 'cat:expense', label: '費用の最上位' },
      { id: 'food', label: '　食費' },
    ])
  })

  it('入れ子のグループは深さに応じて字下げする', () => {
    const result = listMoveDestinations(nodes, categories, ['misc'])
    expect(result.map((d) => d.label)).toEqual(['費用の最上位', '　食費', '　住居', '　　光熱費'])
  })

  it('複数の区分にまたがる選択のときは候補を返さない', () => {
    expect(listMoveDestinations(nodes, categories, ['misc', 'salary'])).toEqual([])
  })
})
