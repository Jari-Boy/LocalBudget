import type { TreeSelectCategory, TreeSelectNode } from '../common/tree-select/treeSelectModel'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'

/**
 * ツリーのノード(マスタの表と同じ、グループは「g:1」などのid)の値を、TreeSelectに渡す値に変換する。
 * TreeSelectは「g:」で始まる値を「グループごと選ぶ」値として扱うため、重ならないよう「n:」を付ける(計画Issue #234)
 */
export const encodeGroupNodeValue = (nodeId: string): string => `n:${nodeId}`

/** encodeGroupNodeValueの逆。接頭辞が無い値(区分の最上位「cat:…」など)はそのまま返す */
export const decodeGroupNodeValue = (value: string): string => (value.startsWith('n:') ? value.slice(2) : value)

/**
 * ツリーのノードから、グループを1つ選ぶ選択欄(親グループ・移動先)の候補を作る(計画Issue #234)。
 * グループだけを、親の直後に子が来る順で、深さ・親の値・パス表示名つきの階層で並べる(葉は含まない)。
 * categoryKeyを渡すと、その区分のグループだけを出す。excludedIdsのノードは出さない(移動する行とその配下など)。
 * グループが無ければカテゴリを返さない。DB・DOM非依存の純粋関数。
 */
export function buildGroupNodeCategories({
  nodes,
  categoryKey,
  excludedIds,
}: {
  nodes: readonly TreeTableNode[]
  categoryKey?: string
  excludedIds: readonly string[]
}): TreeSelectCategory[] {
  const excluded = new Set(excludedIds)
  const groups = nodes.filter((n) => n.kind === 'group' && (categoryKey === undefined || n.category === categoryKey) && !excluded.has(n.id))
  const out: TreeSelectNode[] = []
  const walk = (parentId: string | null, prefix: string, depth: number) => {
    for (const group of groups.filter((g) => g.parentId === parentId)) {
      const pathName = prefix === '' ? group.name : `${prefix} > ${group.name}`
      out.push({
        kind: 'item',
        value: encodeGroupNodeValue(group.id),
        name: group.name,
        isActive: true,
        depth,
        parentValue: parentId === null ? null : encodeGroupNodeValue(parentId),
        pathName,
      })
      walk(group.id, pathName, depth + 1)
    }
  }
  walk(null, '', 0)
  return out.length === 0 ? [] : [{ key: 'groups', name: 'グループ', nodes: out }]
}
