import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { Project } from '../../domain/project/Project'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { TreeTableCategory, TreeTableNode } from '../common/tree-table/treeTableModel'

/**
 * マスタ画面のツリー表に渡すノードの組み立て(計画Issue #154)。勘定科目・取引先・プロジェクトの
 * ドメインデータ(グループと項目)を、汎用のTreeTableNodeへ変換する純粋関数。DB・DOM非依存。
 */

export interface MasterTreeData {
  categories: TreeTableCategory[]
  nodes: TreeTableNode[]
  /** DBに入っている現在の並び順(ノードidごと)。computeTreeNodeUpdatesが差分の判定に使う */
  sortOrders: Map<string, number>
}

const GROUP_PREFIX = 'g:'
const LEAF_PREFIX = 'l:'

/** グループのノードid。項目のidと衝突しない */
export function groupNodeId(id: number): string {
  return `${GROUP_PREFIX}${id}`
}

/** 項目(科目・取引先・プロジェクト)のノードid */
export function leafNodeId(id: number): string {
  return `${LEAF_PREFIX}${id}`
}

/** ノードidを、種別とドメインのidに戻す */
export function parseNodeId(nodeId: string): { kind: 'group' | 'leaf'; id: number } {
  const isGroup = nodeId.startsWith(GROUP_PREFIX)
  return { kind: isGroup ? 'group' : 'leaf', id: Number(nodeId.slice(2)) }
}

const ACCOUNT_CATEGORIES: ReadonlyArray<{ key: AccountCategory; name: string }> = [
  { key: 'asset', name: '資産' },
  { key: 'liability', name: '負債' },
  { key: 'expense', name: '費用' },
  { key: 'revenue', name: '収益' },
  { key: 'equity', name: '資本' },
]

interface RawNode {
  node: TreeTableNode
  sortOrder: number
}

/**
 * 並び順(sortOrder)の昇順にノードを並べ、DBの現在の並び順を一緒に返す。同じ値は
 * グループを先に、次にid順とする。入れ物ごとの順序は、全体の配列内の出現順で決まる。
 */
function assemble(
  categories: TreeTableCategory[],
  raws: RawNode[],
): MasterTreeData {
  const sorted = [...raws].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    if (a.node.kind !== b.node.kind) return a.node.kind === 'group' ? -1 : 1
    return parseNodeId(a.node.id).id - parseNodeId(b.node.id).id
  })
  return {
    categories,
    nodes: sorted.map((r) => r.node),
    sortOrders: new Map(raws.map((r) => [r.node.id, r.sortOrder])),
  }
}

function stateText(item: { isActive: boolean; isSystemManaged?: boolean }): string {
  if (item.isSystemManaged) return 'システム管理'
  return item.isActive ? '有効' : '無効'
}

export function buildAccountTree({
  groups,
  accounts,
  memberNameById,
}: {
  groups: readonly AccountGroup[]
  accounts: readonly Account[]
  memberNameById: ReadonlyMap<number, string>
}): MasterTreeData {
  const raws: RawNode[] = [
    ...groups.map((g) => ({
      sortOrder: g.sortOrder,
      node: {
        id: groupNodeId(g.id),
        kind: 'group' as const,
        category: g.category,
        parentId: g.parentGroupId === null ? null : groupNodeId(g.parentGroupId),
        name: g.name,
        cells: ['', ''],
      },
    })),
    ...accounts.map((a) => ({
      sortOrder: a.sortOrder,
      node: {
        id: leafNodeId(a.id),
        kind: 'leaf' as const,
        category: a.category,
        parentId: a.accountGroupId === null ? null : groupNodeId(a.accountGroupId),
        name: a.name,
        cells: [
          a.householdMemberId === null ? '全員' : (memberNameById.get(a.householdMemberId) ?? '全員'),
          stateText(a),
        ],
      },
    })),
  ]
  return assemble(ACCOUNT_CATEGORIES.map((c) => ({ key: c.key, name: c.name })), raws)
}

export function buildCounterpartyTree({
  groups,
  counterparties,
  accountNameById,
  patternCountById,
}: {
  groups: readonly CounterpartyGroup[]
  counterparties: readonly Counterparty[]
  accountNameById: ReadonlyMap<number, string>
  patternCountById: ReadonlyMap<number, number>
}): MasterTreeData {
  const category = 'counterparty'
  const raws: RawNode[] = [
    ...groups.map((g) => ({
      sortOrder: g.sortOrder,
      node: {
        id: groupNodeId(g.id),
        kind: 'group' as const,
        category,
        parentId: g.parentGroupId === null ? null : groupNodeId(g.parentGroupId),
        name: g.name,
        cells: ['', ''],
      },
    })),
    ...counterparties.map((c) => {
      const patternCount = patternCountById.get(c.id) ?? 0
      return {
        sortOrder: c.sortOrder,
        node: {
          id: leafNodeId(c.id),
          kind: 'leaf' as const,
          category,
          parentId: c.counterpartyGroupId === null ? null : groupNodeId(c.counterpartyGroupId),
          name: c.name,
          cells: [c.defaultAccountId === null ? '' : (accountNameById.get(c.defaultAccountId) ?? ''), stateText(c)],
          ...(patternCount > 0 ? { note: `パターン${patternCount}件` } : {}),
        },
      }
    }),
  ]
  return assemble([{ key: category, name: 'すべての取引先' }], raws)
}

export function buildProjectTree({
  groups,
  projects,
}: {
  groups: readonly ProjectGroup[]
  projects: readonly Project[]
}): MasterTreeData {
  const category = 'project'
  const raws: RawNode[] = [
    ...groups.map((g) => ({
      sortOrder: g.sortOrder,
      node: {
        id: groupNodeId(g.id),
        kind: 'group' as const,
        category,
        parentId: g.parentGroupId === null ? null : groupNodeId(g.parentGroupId),
        name: g.name,
        cells: [''],
      },
    })),
    ...projects.map((p) => ({
      sortOrder: p.sortOrder,
      node: {
        id: leafNodeId(p.id),
        kind: 'leaf' as const,
        category,
        parentId: p.projectGroupId === null ? null : groupNodeId(p.projectGroupId),
        name: p.name,
        cells: [stateText(p)],
      },
    })),
  ]
  return assemble([{ key: category, name: 'すべてのプロジェクト' }], raws)
}
