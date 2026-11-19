/**
 * buildGroupNodeCategories(ツリーのノードから、グループを1つ選ぶ選択欄の候補を作る純粋関数、計画Issue #234)のテスト。
 * グループだけを、深さ・親の値・パス表示名つきの階層で並べ、同じ区分のグループだけを出し、
 * 指定したノード(移動する行とその配下など)を除くことを検証する。値はTreeSelectの「g:」の接頭辞と重ならないよう変換する。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { buildGroupNodeCategories, decodeGroupNodeValue, encodeGroupNodeValue } from './groupNodeSelectCategories'

const node = (id: string, kind: 'group' | 'leaf', category: string, parentId: string | null, name: string): TreeTableNode => ({
  id,
  kind,
  category,
  parentId,
  name,
  cells: [],
})

const nodes: TreeTableNode[] = [
  node('g:1', 'group', 'expense', null, '食費'),
  node('g:2', 'group', 'expense', 'g:1', '外食'),
  node('a:10', 'leaf', 'expense', 'g:2', '昼食'),
  node('g:3', 'group', 'expense', null, '住居'),
  node('g:4', 'group', 'revenue', null, '給与'),
]

describe('buildGroupNodeCategories', () => {
  it('グループだけを、親子の順に、深さ・親の値・パス表示名つきで並べる(葉は含まない)', () => {
    const [category] = buildGroupNodeCategories({ nodes, categoryKey: 'expense', excludedIds: [] })
    expect(category.nodes.map((n) => n.kind === 'item' && [n.value, n.name, n.depth, n.parentValue, n.pathName])).toEqual([
      ['n:g:1', '食費', 0, null, '食費'],
      ['n:g:2', '外食', 1, 'n:g:1', '食費 > 外食'],
      ['n:g:3', '住居', 0, null, '住居'],
    ])
  })

  it('区分を指定すると、その区分のグループだけを出す。指定しなければすべてのグループを出す', () => {
    const [revenue] = buildGroupNodeCategories({ nodes, categoryKey: 'revenue', excludedIds: [] })
    expect(revenue.nodes.map((n) => n.kind === 'item' && n.name)).toEqual(['給与'])
    const [all] = buildGroupNodeCategories({ nodes, excludedIds: [] })
    expect(all.nodes).toHaveLength(4)
  })

  it('除くノードに指定したグループは、候補に出さない', () => {
    const [category] = buildGroupNodeCategories({ nodes, categoryKey: 'expense', excludedIds: ['g:1', 'g:2'] })
    expect(category.nodes.map((n) => n.kind === 'item' && n.name)).toEqual(['住居'])
  })

  it('グループが1つも無ければ、カテゴリを返さない', () => {
    expect(buildGroupNodeCategories({ nodes: [], excludedIds: [] })).toEqual([])
  })
})

describe('encodeGroupNodeValue / decodeGroupNodeValue', () => {
  it('ノードidを「n:」つきの値に変換し、元に戻せる(TreeSelectの「g:」と重ならない)', () => {
    expect(encodeGroupNodeValue('g:5')).toBe('n:g:5')
    expect(decodeGroupNodeValue('n:g:5')).toBe('g:5')
  })

  it('接頭辞の無い値(区分の最上位 cat:…)は、そのまま返す', () => {
    expect(decodeGroupNodeValue('cat:expense')).toBe('cat:expense')
  })
})
