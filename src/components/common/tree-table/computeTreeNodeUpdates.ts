import type { TreeTableNode } from './treeTableModel'

export interface TreeNodeUpdate {
  id: string
  parentId: string | null
  sortOrder: number
}

/** 同じ入れ物(区分と親グループの組)に属する兄弟のidを、配列内の出現順で集める */
function siblingsByContainer(nodes: readonly TreeTableNode[]): Map<string, string[]> {
  const containers = new Map<string, string[]>()
  for (const node of nodes) {
    const key = `${node.category}|${node.parentId ?? ''}`
    const siblings = containers.get(key)
    if (siblings) siblings.push(node.id)
    else containers.set(key, [node.id])
  }
  return containers
}

/**
 * ツリー表での移動の結果(移動前後のノード配列)から、DBへ書き戻す差分を求める(計画Issue #154)。
 * 兄弟の並びが変わった入れ物(移動元・移動先・並び替えをした入れ物)だけを対象に、並び順を
 * 配列内の順に0からの連番へ振り直し、親または並び順が現在と違うノードだけを返す。並び順は
 * 他ノードと重複しうる(docs/domain/accounts.md 3.3)ため、影響を受けた入れ物は連番に正規化し、
 * 影響を受けない入れ物には触れない。返す順は移動後の配列の順。
 * currentSortOrdersは、DBに入っている現在の並び順(ノードidごと)。
 */
export function computeTreeNodeUpdates(
  prev: readonly TreeTableNode[],
  next: readonly TreeTableNode[],
  currentSortOrders: ReadonlyMap<string, number>,
): TreeNodeUpdate[] {
  const prevContainers = siblingsByContainer(prev)
  const nextContainers = siblingsByContainer(next)
  const prevParentById = new Map(prev.map((n) => [n.id, n.parentId]))

  const affected = new Set<string>()
  for (const [key, ids] of nextContainers) {
    const before = prevContainers.get(key)
    if (!before || before.length !== ids.length || before.some((id, i) => id !== ids[i])) affected.add(key)
  }

  const updates: TreeNodeUpdate[] = []
  for (const node of next) {
    const key = `${node.category}|${node.parentId ?? ''}`
    if (!affected.has(key)) continue
    const sortOrder = nextContainers.get(key)!.indexOf(node.id)
    const parentChanged = prevParentById.get(node.id) !== node.parentId
    if (parentChanged || currentSortOrders.get(node.id) !== sortOrder) {
      updates.push({ id: node.id, parentId: node.parentId, sortOrder })
    }
  }
  return updates
}
