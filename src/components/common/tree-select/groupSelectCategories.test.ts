/**
 * buildGroupSelectCategories(グループを1つ選ぶ選択欄のカテゴリ、計画Issue #207)の単体テスト。
 * 取引先・プロジェクトの追加ダイアログで「グループ」を選ぶとき、入れ子のグループを
 * 「親 / 子」の名前で並べた1つのカテゴリにする。並び順は表示順(同じ入れ物の中でsortOrder→id)、
 * 親の直後に子が来る。無効なグループは選べない印(isActive: false)を付ける。DB・DOM非依存、外部依存なし。
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

  it('入れ子のグループを「親 / 子」の名前で、親の直後に子が来る順に1つのカテゴリへ並べる', () => {
    const categories = buildGroupSelectCategories([
      group(1, '食料品', null, 1),
      group(2, '日用品', null, 2),
      group(3, 'スーパー', 1, 1),
      group(4, '市場', 1, 2),
    ])

    expect(categories).toHaveLength(1)
    expect(categories[0].nodes).toEqual([
      { kind: 'item', value: '1', name: '食料品', isActive: true },
      { kind: 'item', value: '3', name: '食料品 / スーパー', isActive: true },
      { kind: 'item', value: '4', name: '食料品 / 市場', isActive: true },
      { kind: 'item', value: '2', name: '日用品', isActive: true },
    ])
  })

  it('同じ入れ物の中では、sortOrderが同じならidの小さい順に並べる', () => {
    const categories = buildGroupSelectCategories([group(5, 'B', null, 0), group(2, 'A', null, 0)])

    expect(categories[0].nodes.map((n) => n.kind === 'item' && n.value)).toEqual(['2', '5'])
  })

  it('無効なグループには選べない印(isActive: false)を付ける', () => {
    const categories = buildGroupSelectCategories([group(1, '旧グループ', null, 0, false)])

    expect(categories[0].nodes).toEqual([{ kind: 'item', value: '1', name: '旧グループ', isActive: false }])
  })
})
