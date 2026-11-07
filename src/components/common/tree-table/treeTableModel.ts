/**
 * ツリー表(マスタ用)の行の組み立てと移動判定の純粋関数(計画Issue #150)。
 * 科目・取引先・プロジェクトで共通に使うため、ドメインの型には依存せず、
 * 区分(category)・グループ・葉の汎用ノード型だけを扱う。DB・DOM非依存。
 * ノードは「並び順を持つ平らな配列」で、親子はparentIdで表す。同じ親の兄弟の順序は
 * 配列内の出現順で決まる。
 */
export interface TreeTableNode {
  id: string
  kind: 'group' | 'leaf'
  category: string
  /** 親グループのid。区分の最上位ならnull */
  parentId: string | null
  name: string
  /** 名称の右に並べる列の表示値(列見出しと同じ順) */
  cells: string[]
  /** 名称の横に出す補足(例: 「パターン2件」)。グループは配下の件数を自動で出すため不要 */
  note?: string
}

export interface TreeTableCategory {
  key: string
  name: string
}

export interface TreeTableCategoryRow {
  type: 'category'
  key: string
  name: string
  /** 区分に属する葉の数 */
  count: number
}

export interface TreeTableNodeRow {
  type: 'node'
  node: TreeTableNode
  depth: number
  isGroup: boolean
  isOpen: boolean
  /** グループの配下(入れ子を含む)の葉の数。葉は0 */
  leafCount: number
}

export type TreeTableRow = TreeTableCategoryRow | TreeTableNodeRow

export type DropZone = 'before' | 'after' | 'inside'

/** 区分の見出し行のidの接頭辞(移動先として指定する) */
export const CATEGORY_ID_PREFIX = 'cat:'

export interface MoveTarget {
  id: string
  zone: DropZone
}

export type MoveResult =
  | { ok: true; nodes: TreeTableNode[]; expandId?: string }
  | { ok: false; reason: string }

export const REASON_CROSS_CATEGORY = '区分をまたいで移動できません'
export const REASON_INTO_SELF = '自分自身の配下には移動できません'
const REASON_INTO_LEAF = '科目などの葉の中へは移動できません'

function descendantIdsOf(nodes: readonly TreeTableNode[], id: string): string[] {
  return nodes
    .filter((n) => n.parentId === id)
    .flatMap((n) => [n.id, ...descendantIdsOf(nodes, n.id)])
}

function leafCountOf(nodes: readonly TreeTableNode[], id: string): number {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return descendantIdsOf(nodes, id).filter((d) => byId.get(d)?.kind === 'leaf').length
}

export function buildTreeTableRows({
  categories,
  nodes,
  collapsedIds,
}: {
  categories: readonly TreeTableCategory[]
  nodes: readonly TreeTableNode[]
  collapsedIds: ReadonlySet<string>
}): TreeTableRow[] {
  const walk = (category: string, parentId: string | null, depth: number): TreeTableRow[] =>
    nodes
      .filter((n) => n.category === category && n.parentId === parentId)
      .flatMap((n): TreeTableRow[] => {
        const isGroup = n.kind === 'group'
        const isOpen = isGroup && !collapsedIds.has(n.id)
        return [
          { type: 'node', node: n, depth, isGroup, isOpen, leafCount: isGroup ? leafCountOf(nodes, n.id) : 0 },
          ...(isOpen ? walk(category, n.id, depth + 1) : []),
        ]
      })

  return categories.flatMap((category) => [
    {
      type: 'category' as const,
      key: category.key,
      name: category.name,
      count: nodes.filter((n) => n.category === category.key && n.kind === 'leaf').length,
    },
    ...walk(category.key, null, 0),
  ])
}

/**
 * ドロップ位置(行の高さに対するカーソルの割合0〜1)から挿入位置を決める。
 * グループは上端25%で前、下端25%で後ろ、中央で中へ。葉は中へ入れないため半分で前後に分ける。
 */
export function dropZoneFor(isGroup: boolean, ratio: number): DropZone {
  if (isGroup) return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}

/**
 * ノードの移動を判定し、移動後のノード配列を返す。区分をまたぐ移動、自分自身・自分の配下への移動、
 * 葉の中への移動は拒否する(resolveAccountGroupDropと同じ判定)。1件だけを自分自身の上へ
 * 落とした場合は変更なしとして成功を返す。元の配列は書き換えない。
 */
export function resolveTreeMove(
  nodes: readonly TreeTableNode[],
  ids: readonly string[],
  target: MoveTarget,
): MoveResult {
  const toCategory = target.id.startsWith(CATEGORY_ID_PREFIX)
  const targetNode = toCategory ? undefined : nodes.find((n) => n.id === target.id)
  if (!toCategory && !targetNode) return { ok: false, reason: REASON_INTO_SELF }

  if (ids.length === 1 && ids[0] === target.id) return { ok: true, nodes: [...nodes] }

  const targetCategory = toCategory ? target.id.slice(CATEGORY_ID_PREFIX.length) : targetNode!.category
  const moving = nodes.filter((n) => ids.includes(n.id))
  if (moving.some((n) => n.category !== targetCategory)) return { ok: false, reason: REASON_CROSS_CATEGORY }
  if (ids.some((id) => id === target.id || descendantIdsOf(nodes, id).includes(target.id))) {
    return { ok: false, reason: REASON_INTO_SELF }
  }
  if (target.zone === 'inside' && targetNode && targetNode.kind !== 'group') {
    return { ok: false, reason: REASON_INTO_LEAF }
  }

  const inside = toCategory || target.zone === 'inside'
  const parentId = toCategory ? null : inside ? target.id : targetNode!.parentId
  const rest = nodes.filter((n) => !ids.includes(n.id))
  const moved = moving.map((n) => ({ ...n, parentId }))
  const at = inside ? rest.length : rest.findIndex((n) => n.id === target.id) + (target.zone === 'after' ? 1 : 0)
  return {
    ok: true,
    nodes: [...rest.slice(0, at), ...moved, ...rest.slice(at)],
    expandId: !toCategory && inside ? target.id : undefined,
  }
}

export interface MoveDestination {
  /** resolveTreeMoveのtarget.id(区分の最上位は「cat:区分」)。zoneは'inside'で使う */
  id: string
  label: string
}

/**
 * 「移動先を選ぶ」ための候補(ドラッグができない操作・一括移動用)。選択した行がすべて同じ区分に
 * 属するときだけ、その区分の最上位と、移動対象とその配下を除くグループを字下げ付きで返す。
 */
export function listMoveDestinations(
  nodes: readonly TreeTableNode[],
  categories: readonly TreeTableCategory[],
  ids: readonly string[],
): MoveDestination[] {
  const moving = nodes.filter((n) => ids.includes(n.id))
  const movingCategories = [...new Set(moving.map((n) => n.category))]
  if (movingCategories.length !== 1) return []
  const categoryKey = movingCategories[0]
  const excluded = new Set(ids.flatMap((id) => [id, ...descendantIdsOf(nodes, id)]))
  const categoryName = categories.find((c) => c.key === categoryKey)?.name ?? categoryKey

  const walk = (parentId: string | null, depth: number): MoveDestination[] =>
    nodes
      .filter((n) => n.category === categoryKey && n.parentId === parentId && n.kind === 'group' && !excluded.has(n.id))
      .flatMap((n) => [{ id: n.id, label: `${'　'.repeat(depth + 1)}${n.name}` }, ...walk(n.id, depth + 1)])

  return [{ id: `${CATEGORY_ID_PREFIX}${categoryKey}`, label: `${categoryName}の最上位` }, ...walk(null, 0)]
}
