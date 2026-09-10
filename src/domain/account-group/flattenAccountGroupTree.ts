import type { AccountGroup } from './AccountGroup'

export interface AccountGroupTreeNode {
  group: AccountGroup
  depth: number
}

/**
 * 勘定科目グループの入れ子構造(parent_group_idによる多階層、docs/domain/accounts.md
 * 3.3節)を、展開/折りたたみ式ツリーではなく深さに応じたインデント付きフラットリストで
 * 表現するための純粋関数(計画Issue #112、UI側の表示方針)。最上位グループ
 * (parentGroupId === null)から深さ優先で辿り、各グループの直後にその子グループを
 * 並べる。同じ親を持つ兄弟グループの順序は元の配列の並び順を維持する。DB非依存。
 */
export function flattenAccountGroupTree(groups: readonly AccountGroup[]): AccountGroupTreeNode[] {
  const childrenByParentId = new Map<number | null, AccountGroup[]>()
  for (const group of groups) {
    const children = childrenByParentId.get(group.parentGroupId) ?? []
    children.push(group)
    childrenByParentId.set(group.parentGroupId, children)
  }

  const result: AccountGroupTreeNode[] = []
  const visit = (parentId: number | null, depth: number) => {
    for (const group of childrenByParentId.get(parentId) ?? []) {
      result.push({ group, depth })
      visit(group.id, depth + 1)
    }
  }
  visit(null, 0)
  return result
}
