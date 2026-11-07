import type { TreeSelectCategory, TreeSelectNode } from '../common/tree-select/treeSelectModel'
import type { TreeTableNode } from '../common/tree-table/treeTableModel'
import { parseNodeId, type MasterTreeData } from './masterTreeNodes'

/**
 * マスタのツリー(科目・取引先・プロジェクト)を、選択ツリー(TreeSelect)のカテゴリに変換する
 * (計画Issue #154)。項目の値はドメインのid(文字列)、グループのidもドメインのid
 * (グループごと選ぶ値の「g:」はTreeSelect側で付く)。inactiveLeafIdsは無効な項目のid。
 */
export function buildTreeSelectCategories(
  tree: MasterTreeData,
  inactiveLeafIds: ReadonlySet<number>,
): TreeSelectCategory[] {
  const convert = (nodes: readonly TreeTableNode[], category: string, parentId: string | null): TreeSelectNode[] =>
    nodes
      .filter((n) => n.category === category && n.parentId === parentId)
      .map((n): TreeSelectNode => {
        const { id } = parseNodeId(n.id)
        return n.kind === 'group'
          ? { kind: 'group', id: String(id), name: n.name, children: convert(nodes, category, n.id) }
          : { kind: 'item', value: String(id), name: n.name, isActive: !inactiveLeafIds.has(id) }
      })

  return tree.categories.map((c) => ({ key: c.key, name: c.name, nodes: convert(tree.nodes, c.key, null) }))
}
