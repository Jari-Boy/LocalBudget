import type { TreeSelectCategory, TreeSelectNode } from './treeSelectModel'

interface GroupLike {
  id: number
  name: string
  parentGroupId: number | null
  sortOrder: number
  isActive: boolean
}

/**
 * グループを1つ選ぶ選択欄のカテゴリ(計画Issue #207)。取引先・プロジェクトの追加ダイアログで使う。
 * 入れ子のグループは「親 / 子」の名前の項目にして、親の直後に子が来る順(同じ入れ物の中ではsortOrder→id)に並べる。
 * グループが無ければカテゴリを返さない。DB・DOM非依存の純粋関数。
 */
export function buildGroupSelectCategories(groups: readonly GroupLike[]): TreeSelectCategory[] {
  if (groups.length === 0) return []
  const childrenOf = (parentId: number | null) =>
    groups
      .filter((g) => g.parentGroupId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const nodes: TreeSelectNode[] = []
  const walk = (parentId: number | null, prefix: string) => {
    for (const group of childrenOf(parentId)) {
      const name = prefix === '' ? group.name : `${prefix} / ${group.name}`
      nodes.push({ kind: 'item', value: String(group.id), name, isActive: group.isActive })
      walk(group.id, name)
    }
  }
  walk(null, '')
  return [{ key: 'groups', name: 'グループ', nodes }]
}
