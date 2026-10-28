import type { Account } from '../account/Account'
import type { AccountGroup } from './AccountGroup'

export interface AccountGroupForestAccountNode {
  kind: 'account'
  account: Account
}

export interface AccountGroupForestGroupNode {
  kind: 'group'
  group: AccountGroup
  children: AccountGroupForestNode[]
}

export type AccountGroupForestNode = AccountGroupForestGroupNode | AccountGroupForestAccountNode

function sortOrderOf(node: AccountGroupForestNode): number {
  return node.kind === 'group' ? node.group.sortOrder : node.account.sortOrder
}

/**
 * account_groups(parentGroupIdによる自己参照)とaccounts(accountGroupId)から、
 * サブグループ+直属科目を1つのsortOrderで混在させたツリー構造を組み立てる純粋関数
 * (計画Issue #129)。最上位グループ(parentGroupId === null)がルートノードになる。
 * 各グループの子は「サブグループ+直属科目」をsortOrderの昇順で混在させた単一の配列で、
 * 科目とグループが入り混じった並び順を表現する。categoryによるセクション分け(資産/負債/
 * 収益/費用)は表示側(UI層)の責務とし、この関数は行わない。DB非依存。
 */
export function buildAccountGroupForest(
  groups: readonly AccountGroup[],
  accounts: readonly Account[],
): AccountGroupForestGroupNode[] {
  const childGroupsByParentId = new Map<number, AccountGroup[]>()
  for (const group of groups) {
    if (group.parentGroupId === null) continue
    const children = childGroupsByParentId.get(group.parentGroupId) ?? []
    children.push(group)
    childGroupsByParentId.set(group.parentGroupId, children)
  }

  const accountsByGroupId = new Map<number, Account[]>()
  for (const account of accounts) {
    if (account.accountGroupId === null) continue
    const list = accountsByGroupId.get(account.accountGroupId) ?? []
    list.push(account)
    accountsByGroupId.set(account.accountGroupId, list)
  }

  const buildNode = (group: AccountGroup): AccountGroupForestGroupNode => {
    const childGroupNodes: AccountGroupForestNode[] = (childGroupsByParentId.get(group.id) ?? []).map(buildNode)
    const childAccountNodes: AccountGroupForestNode[] = (accountsByGroupId.get(group.id) ?? []).map(
      (account) => ({ kind: 'account', account }) satisfies AccountGroupForestAccountNode,
    )
    const children = [...childGroupNodes, ...childAccountNodes].sort((a, b) => sortOrderOf(a) - sortOrderOf(b))
    return { kind: 'group', group, children }
  }

  return groups
    .filter((group) => group.parentGroupId === null)
    .map(buildNode)
    .sort((a, b) => a.group.sortOrder - b.group.sortOrder)
}
