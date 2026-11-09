import type { Account } from '../account/Account'
import type { AccountGroup } from '../account-group/AccountGroup'
import { buildAccountGroupForest, type AccountGroupForestNode } from '../account-group/buildAccountGroupForest'
import type { AccountAmount } from '../financial-statement/AccountAmount'

export interface StatementRow {
  kind: 'group' | 'account'
  /** 科目の行のとき、科目のid */
  accountId?: number
  /** グループの行のとき、グループのid */
  groupId?: number
  name: string
  depth: number
  current: number
  /** 比較の金額。比較なしならnull */
  compare: number | null
  /** 当期−比較。比較なしならnull */
  difference: number | null
  /** グループの行のとき、折りたたまれているか */
  isCollapsed: boolean
}

export interface BuildStatementRowsInput {
  /** 表示する区分の科目とグループ(呼び出し側で区分を絞って渡す) */
  accounts: readonly Account[]
  groups: readonly AccountGroup[]
  current: readonly AccountAmount[]
  comparison: readonly AccountAmount[] | null
  collapsedGroupIds: ReadonlySet<number>
}

/**
 * PL・BSの科目別の金額を、マスタの科目グループの階層で並べた行にする(分析画面の財務諸表タブ、
 * 計画Issue #155)。グループの行は入れ子を含む配下の科目の合計。当期も比較も0の科目・グループは
 * 出さず、折りたたんだグループの配下は出さない(グループの行の金額は変わらない)。
 * グループに属さない科目は、グループの後に最上位の行として並べる。DB非依存の純粋関数。
 */
export function buildStatementRows({
  accounts,
  groups,
  current,
  comparison,
  collapsedGroupIds,
}: BuildStatementRowsInput): StatementRow[] {
  const currentById = new Map(current.map((item) => [item.accountId, item.amount]))
  const compareById = new Map((comparison ?? []).map((item) => [item.accountId, item.amount]))
  const hasComparison = comparison !== null

  const cells = (currentAmount: number, compareAmount: number) => ({
    current: currentAmount,
    compare: hasComparison ? compareAmount : null,
    difference: hasComparison ? currentAmount - compareAmount : null,
  })

  interface Totals {
    current: number
    compare: number
  }
  const totalsOf = (node: AccountGroupForestNode): Totals => {
    if (node.kind === 'account') {
      return { current: currentById.get(node.account.id) ?? 0, compare: compareById.get(node.account.id) ?? 0 }
    }
    return node.children.reduce<Totals>(
      (sum, child) => {
        const t = totalsOf(child)
        return { current: sum.current + t.current, compare: sum.compare + t.compare }
      },
      { current: 0, compare: 0 },
    )
  }
  const hasAmount = (node: AccountGroupForestNode) => {
    const has = (n: AccountGroupForestNode): boolean =>
      n.kind === 'account'
        ? (currentById.get(n.account.id) ?? 0) !== 0 || (compareById.get(n.account.id) ?? 0) !== 0
        : n.children.some(has)
    return has(node)
  }

  const walk = (nodes: readonly AccountGroupForestNode[], depth: number): StatementRow[] =>
    nodes.flatMap((node): StatementRow[] => {
      if (!hasAmount(node)) return []
      const totals = totalsOf(node)
      if (node.kind === 'account') {
        return [
          {
            kind: 'account',
            accountId: node.account.id,
            name: node.account.name,
            depth,
            isCollapsed: false,
            ...cells(totals.current, totals.compare),
          },
        ]
      }
      const isCollapsed = collapsedGroupIds.has(node.group.id)
      return [
        {
          kind: 'group',
          groupId: node.group.id,
          name: node.group.name,
          depth,
          isCollapsed,
          ...cells(totals.current, totals.compare),
        },
        ...(isCollapsed ? [] : walk(node.children, depth + 1)),
      ]
    })

  const groupRoots = buildAccountGroupForest(groups, accounts)
  const ungrouped: AccountGroupForestNode[] = accounts
    .filter((account) => account.accountGroupId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((account) => ({ kind: 'account', account }))
  return walk([...groupRoots, ...ungrouped], 0)
}
