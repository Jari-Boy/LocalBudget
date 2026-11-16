/**
 * filterTreeNodes(ツリー表の検索による絞り込み)のテスト。
 * 項目(葉)は名称か表示列に検索語を含むものだけ残し、グループは配下に残る項目があるとき、または
 * グループ自身の名称が一致したとき(配下の項目をすべて残す)に残す。全角半角・大文字小文字・空白は無視し、
 * 検索語が空なら元のノードをそのまま返すことを検証する(計画Issue #219)。
 * 外部依存なし(DB・DOMに依存しない汎用ノード型のみ)。
 */
import { describe, expect, it } from 'vitest'
import { filterTreeNodes } from './filterTreeNodes'
import type { TreeTableNode } from './treeTableModel'

const node = (id: string, kind: 'group' | 'leaf', parentId: string | null, name: string, cells: string[] = []): TreeTableNode => ({
  id,
  kind,
  category: 'all',
  parentId,
  name,
  cells,
})

const nodes: TreeTableNode[] = [
  node('g-food', 'group', null, '食べ物'),
  node('apple', 'leaf', 'g-food', 'りんご', ['果物']),
  node('beef', 'leaf', 'g-food', '牛肉', ['肉']),
  node('g-tool', 'group', null, '道具'),
  node('hammer', 'leaf', 'g-tool', 'ハンマー', ['大工']),
  node('loose', 'leaf', null, 'Apple Pie', []),
]

const ids = (result: TreeTableNode[]) => result.map((n) => n.id)

describe('filterTreeNodes', () => {
  it('検索語が空(空白だけを含む)なら、元のノードをそのまま返す', () => {
    expect(filterTreeNodes(nodes, '')).toBe(nodes)
    expect(filterTreeNodes(nodes, '  ')).toBe(nodes)
  })

  it('名称に検索語を含む項目と、その項目を持つグループだけを残す(並びは元のまま)', () => {
    expect(ids(filterTreeNodes(nodes, 'りんご'))).toEqual(['g-food', 'apple'])
  })

  it('表示列(cells)に検索語を含む項目も残す', () => {
    expect(ids(filterTreeNodes(nodes, '大工'))).toEqual(['g-tool', 'hammer'])
  })

  it('グループ自身の名称が一致したときは、配下の項目をすべて残す', () => {
    expect(ids(filterTreeNodes(nodes, '食べ物'))).toEqual(['g-food', 'apple', 'beef'])
  })

  it('全角半角・大文字小文字・空白を無視して一致させる', () => {
    expect(ids(filterTreeNodes(nodes, 'ａｐｐｌｅ  ｐｉｅ'))).toEqual(['loose'])
  })

  it('一致するものが無ければ空配列を返す', () => {
    expect(filterTreeNodes(nodes, 'zzz')).toEqual([])
  })
})
