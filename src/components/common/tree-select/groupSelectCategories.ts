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
 * 入れ子のグループは、名前はそのままで深さ(depth)と親の値を付けた項目にして、親の直後に子が来る順(同じ入れ物の中ではsortOrder→id)に並べる。
 * インデントは表示側(buildTreeSelectRows)が付ける(計画Issue #233 案A)。パス表示名(pathName)は閉じた状態の同名の区別に使う。
 * グループが無ければカテゴリを返さない。DB・DOM非依存の純粋関数。
 */
export function buildGroupSelectCategories(groups: readonly GroupLike[]): TreeSelectCategory[] {
  if (groups.length === 0) return []
  const ids = new Set(groups.map((g) => g.id))
  // 親が渡されていない(絞り込みで外れた)グループは最上位として扱い、候補から消さない
  const isRoot = (g: GroupLike) => g.parentGroupId === null || !ids.has(g.parentGroupId)
  const childrenOf = (parentId: number | null) =>
    groups
      .filter((g) => (parentId === null ? isRoot(g) : g.parentGroupId === parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

  const nodes: TreeSelectNode[] = []
  const walk = (parentId: number | null, prefix: string, depth: number) => {
    for (const group of childrenOf(parentId)) {
      const pathName = prefix === '' ? group.name : `${prefix} > ${group.name}`
      nodes.push({
        kind: 'item',
        value: String(group.id),
        name: group.name,
        isActive: group.isActive,
        depth,
        parentValue: parentId === null ? null : String(parentId),
        pathName,
      })
      walk(group.id, pathName, depth + 1)
    }
  }
  walk(null, '', 0)
  return [{ key: 'groups', name: 'グループ', nodes }]
}
