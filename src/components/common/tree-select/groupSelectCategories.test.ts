/**
 * buildGroupSelectCategories(グループを1つ選ぶ選択欄のカテゴリ、計画Issue #207)の単体テスト。
 * グループを選ぶ欄で、入れ子のグループを、親の直後に子が来る順(同じ入れ物の中でsortOrder→id)の
 * 1つのカテゴリにする。階層は名前の連結ではなく、深さ(depth)と親の値(parentValue)で表し、
 * 表示側がインデントで示す(計画Issue #233 案A)。閉じた状態の同名の区別用に「親 > 子」のpathNameも持つ。
 * 無効なグループは選べない印(isActive: false)を付ける。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildGroupSelectCategories } from './groupSelectCategories'

const group = (id: number, name: string, parentGroupId: number | null, sortOrder = 0, isActive = true) => ({
  id,
  name,
  parentGroupId,
  sortOrder,
  isActive,
})

describe('buildGroupSelectCategories', () => {
  it('グループが無ければ、カテゴリを返さない', () => {
    expect(buildGroupSelectCategories([])).toEqual([])
  })

  it('入れ子のグループを、名前はそのままで深さと親の値を付け、親の直後に子が来る順に1つのカテゴリへ並べる', () => {
    const categories = buildGroupSelectCategories([
      group(1, '食料品', null, 1),
      group(2, '日用品', null, 2),
      group(3, 'スーパー', 1, 1),
      group(4, '市場', 1, 2),
    ])

    expect(categories).toHaveLength(1)
    expect(categories[0].nodes).toEqual([
      { kind: 'item', value: '1', name: '食料品', isActive: true, depth: 0, parentValue: null, pathName: '食料品' },
      { kind: 'item', value: '3', name: 'スーパー', isActive: true, depth: 1, parentValue: '1', pathName: '食料品 > スーパー' },
      { kind: 'item', value: '4', name: '市場', isActive: true, depth: 1, parentValue: '1', pathName: '食料品 > 市場' },
      { kind: 'item', value: '2', name: '日用品', isActive: true, depth: 0, parentValue: null, pathName: '日用品' },
    ])
  })

  it('同じ入れ物の中では、sortOrderが同じならidの小さい順に並べる', () => {
    const categories = buildGroupSelectCategories([group(5, 'B', null, 0), group(2, 'A', null, 0)])

    expect(categories[0].nodes.map((n) => n.kind === 'item' && n.value)).toEqual(['2', '5'])
  })

  it('無効なグループには選べない印(isActive: false)を付ける', () => {
    const categories = buildGroupSelectCategories([group(1, '旧グループ', null, 0, false)])

    expect(categories[0].nodes).toEqual([
      { kind: 'item', value: '1', name: '旧グループ', isActive: false, depth: 0, parentValue: null, pathName: '旧グループ' },
    ])
  })

  it('深さ3以上でも、深さと「親 > 子 > 孫」のpathNameが付く', () => {
    const nodes = buildGroupSelectCategories([group(1, 'A', null), group(2, 'B', 1), group(3, 'C', 2)])[0].nodes
    expect(nodes.map((n) => n.kind === 'item' && [n.depth, n.pathName])).toEqual([
      [0, 'A'],
      [1, 'A > B'],
      [2, 'A > B > C'],
    ])
  })

  it('別の親の下に同名の子があっても、値と親が別々に保たれる', () => {
    const nodes = buildGroupSelectCategories([group(1, '食費', null, 1), group(2, '住居', null, 2), group(3, 'その他', 1), group(4, 'その他', 2)])[0].nodes
    expect(nodes.map((n) => n.kind === 'item' && [n.value, n.name, n.parentValue])).toEqual([
      ['1', '食費', null],
      ['3', 'その他', '1'],
      ['2', '住居', null],
      ['4', 'その他', '2'],
    ])
  })
})
