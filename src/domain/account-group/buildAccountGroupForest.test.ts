/**
 * buildAccountGroupForest(計画Issue #129)のテスト。
 * account_groups(parentGroupIdによる自己参照)とaccounts(accountGroupId)から、
 * サブグループ+直属科目を1つの順序(sortOrder)で混在させたツリー構造を組み立てる
 * 純粋関数を検証する。DB非依存(sql.js不使用)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { AccountGroup } from './AccountGroup'
import { buildAccountGroupForest } from './buildAccountGroupForest'

function makeGroup(overrides: Partial<AccountGroup> & Pick<AccountGroup, 'id' | 'name'>): AccountGroup {
  return {
    parentGroupId: null,
    category: 'asset',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAccount(overrides: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    category: 'asset',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildAccountGroupForest', () => {
  it('最上位グループ(parentGroupId === null)だけがルートノードとして返る', () => {
    const parent = makeGroup({ id: 1, name: '固定費' })
    const child = makeGroup({ id: 2, name: 'カード', parentGroupId: 1 })

    const forest = buildAccountGroupForest([parent, child], [])

    expect(forest).toHaveLength(1)
    expect(forest[0].group.id).toBe(1)
  })

  it('グループの直属科目が子ノードとして含まれる', () => {
    const group = makeGroup({ id: 1, name: '水道光熱費' })
    const account = makeAccount({ id: 101, name: '電気代', accountGroupId: 1 })

    const forest = buildAccountGroupForest([group], [account])

    expect(forest[0].children).toHaveLength(1)
    expect(forest[0].children[0]).toEqual({ kind: 'account', account })
  })

  it('サブグループと直属科目は、sortOrderによって混在した1つの順序で並ぶ', () => {
    const parent = makeGroup({ id: 1, name: '現金同等物' })
    const subGroup = makeGroup({ id: 2, name: 'ネット銀行', parentGroupId: 1, sortOrder: 0 })
    const accountA = makeAccount({ id: 101, name: '現金', accountGroupId: 1, sortOrder: 1 })
    const accountB = makeAccount({ id: 102, name: '普通預金', accountGroupId: 1, sortOrder: 2 })

    const forest = buildAccountGroupForest([parent, subGroup], [accountA, accountB])

    const children = forest[0].children
    expect(children.map((c) => (c.kind === 'group' ? c.group.name : c.account.name))).toEqual([
      'ネット銀行',
      '現金',
      '普通預金',
    ])
  })

  it('サブグループ自身の子(孫グループ・孫科目)も再帰的に組み立てられる', () => {
    const root = makeGroup({ id: 1, name: '現金同等物' })
    const sub = makeGroup({ id: 2, name: 'ネット銀行', parentGroupId: 1 })
    const grandchildAccount = makeAccount({ id: 101, name: '楽天銀行', accountGroupId: 2 })

    const forest = buildAccountGroupForest([root, sub], [grandchildAccount])

    const subNode = forest[0].children[0]
    expect(subNode.kind).toBe('group')
    if (subNode.kind !== 'group') throw new Error('unreachable')
    expect(subNode.children).toEqual([{ kind: 'account', account: grandchildAccount }])
  })

  it('ルートグループ同士もsortOrderの昇順で並ぶ', () => {
    const second = makeGroup({ id: 2, name: '住居', sortOrder: 1 })
    const first = makeGroup({ id: 1, name: '現金同等物', sortOrder: 0 })

    const forest = buildAccountGroupForest([second, first], [])

    expect(forest.map((n) => n.group.name)).toEqual(['現金同等物', '住居'])
  })

  it('他グループに属する科目(accountGroupIdが別のid)は子ノードに含まれない', () => {
    const group = makeGroup({ id: 1, name: '水道光熱費' })
    const otherGroup = makeGroup({ id: 2, name: '通信費' })
    const account = makeAccount({ id: 101, name: 'スマホ代', accountGroupId: 2 })

    const forest = buildAccountGroupForest([group, otherGroup], [account])

    const waterUtilityNode = forest.find((n) => n.group.id === 1)!
    expect(waterUtilityNode.children).toHaveLength(0)
  })

  it('未分類の科目(accountGroupId === null)はどのノードにも含まれない', () => {
    const group = makeGroup({ id: 1, name: '水道光熱費' })
    const account = makeAccount({ id: 101, name: '未分類科目', accountGroupId: null })

    const forest = buildAccountGroupForest([group], [account])

    expect(forest[0].children).toHaveLength(0)
  })
})
