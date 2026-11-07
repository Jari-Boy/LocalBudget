/**
 * masterTreeNodes(計画Issue #154)のテスト。
 * マスタ画面のツリー表に渡すノードを、勘定科目・取引先・プロジェクトのドメインデータ
 * (グループと項目)から組み立てる純粋関数を検証する。同じ入れ物の中でグループと項目を
 * 並び順(sortOrder)で混在させて並べること、列(名義・既定の科目・状態)の表示値、
 * ノードidからドメインのidを取り出せること、DBの現在の並び順をidごとに返すことを確認する。
 * DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { Project } from '../../domain/project/Project'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import {
  buildAccountTree,
  buildCounterpartyTree,
  buildProjectTree,
  groupNodeId,
  leafNodeId,
  parseNodeId,
} from './masterTreeNodes'

const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'name' | 'category'>): Account {
  return {
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    ...stamp,
    ...overrides,
  }
}

function accountGroup(
  overrides: Partial<AccountGroup> & Pick<AccountGroup, 'id' | 'name' | 'category'>,
): AccountGroup {
  return { parentGroupId: null, sortOrder: 0, isActive: true, ...stamp, ...overrides }
}

describe('ノードid', () => {
  it('グループと項目のidは衝突せず、parseNodeIdでドメインのidに戻せる', () => {
    expect(groupNodeId(3)).not.toBe(leafNodeId(3))
    expect(parseNodeId(groupNodeId(3))).toEqual({ kind: 'group', id: 3 })
    expect(parseNodeId(leafNodeId(7))).toEqual({ kind: 'leaf', id: 7 })
  })
})

describe('buildAccountTree', () => {
  it('区分は資産・負債・費用・収益・資本の5つで、この順に並ぶ', () => {
    const { categories } = buildAccountTree({ groups: [], accounts: [], memberNameById: new Map() })

    expect(categories).toEqual([
      { key: 'asset', name: '資産' },
      { key: 'liability', name: '負債' },
      { key: 'expense', name: '費用' },
      { key: 'revenue', name: '収益' },
      { key: 'equity', name: '資本' },
    ])
  })

  it('同じ入れ物のグループと科目は、並び順(sortOrder)で混在して並ぶ', () => {
    const { nodes } = buildAccountTree({
      groups: [accountGroup({ id: 1, name: '普通預金', category: 'asset', sortOrder: 1 })],
      accounts: [
        account({ id: 10, name: '現金', category: 'asset', sortOrder: 0 }),
        account({ id: 11, name: '預け金', category: 'asset', sortOrder: 2 }),
        account({ id: 12, name: '楽天銀行', category: 'asset', accountGroupId: 1, sortOrder: 0 }),
      ],
      memberNameById: new Map(),
    })

    const topLevel = nodes.filter((n) => n.parentId === null).map((n) => n.name)
    expect(topLevel).toEqual(['現金', '普通預金', '預け金'])
  })

  it('親グループと区分を、ノードの親と区分に反映する', () => {
    const { nodes } = buildAccountTree({
      groups: [
        accountGroup({ id: 1, name: 'カード', category: 'liability' }),
        accountGroup({ id: 2, name: '夫名義', category: 'liability', parentGroupId: 1 }),
      ],
      accounts: [account({ id: 10, name: '楽天VISA', category: 'liability', accountGroupId: 2 })],
      memberNameById: new Map(),
    })

    expect(nodes.find((n) => n.id === groupNodeId(2))).toMatchObject({
      kind: 'group',
      category: 'liability',
      parentId: groupNodeId(1),
    })
    expect(nodes.find((n) => n.id === leafNodeId(10))).toMatchObject({
      kind: 'leaf',
      category: 'liability',
      parentId: groupNodeId(2),
    })
  })

  it('科目の列は、名義と状態を表示する(名義なしは「全員」、システム管理・無効も区別する)', () => {
    const { nodes } = buildAccountTree({
      groups: [],
      accounts: [
        account({ id: 1, name: '楽天銀行', category: 'asset', householdMemberId: 5 }),
        account({ id: 2, name: '現金', category: 'asset' }),
        account({ id: 3, name: '初期残高', category: 'equity', isSystemManaged: true }),
        account({ id: 4, name: '旧口座', category: 'asset', isActive: false }),
      ],
      memberNameById: new Map([[5, '夫']]),
    })
    const cells = (id: number) => nodes.find((n) => n.id === leafNodeId(id))!.cells

    expect(cells(1)).toEqual(['夫', '有効'])
    expect(cells(2)).toEqual(['全員', '有効'])
    expect(cells(3)).toEqual(['全員', 'システム管理'])
    expect(cells(4)).toEqual(['全員', '無効'])
  })

  it('グループの列は空で、DBの現在の並び順をノードidごとに返す', () => {
    const { nodes, sortOrders } = buildAccountTree({
      groups: [accountGroup({ id: 1, name: 'G', category: 'asset', sortOrder: 4 })],
      accounts: [account({ id: 10, name: 'A', category: 'asset', sortOrder: 2 })],
      memberNameById: new Map(),
    })

    expect(nodes.find((n) => n.id === groupNodeId(1))!.cells).toEqual(['', ''])
    expect(sortOrders.get(groupNodeId(1))).toBe(4)
    expect(sortOrders.get(leafNodeId(10))).toBe(2)
  })
})

describe('buildCounterpartyTree', () => {
  const group = (overrides: Partial<CounterpartyGroup> & Pick<CounterpartyGroup, 'id' | 'name'>): CounterpartyGroup => ({
    parentGroupId: null,
    sortOrder: 0,
    isActive: true,
    ...stamp,
    ...overrides,
  })
  const counterparty = (
    overrides: Partial<Counterparty> & Pick<Counterparty, 'id' | 'name'>,
  ): Counterparty => ({
    defaultAccountId: null,
    counterpartyGroupId: null,
    sortOrder: 0,
    isActive: true,
    ...stamp,
    ...overrides,
  })

  it('区分は「すべての取引先」の1つだけで、既定の科目名と状態を列に出す', () => {
    const { categories, nodes } = buildCounterpartyTree({
      groups: [group({ id: 1, name: 'スーパー' })],
      counterparties: [counterparty({ id: 2, name: 'イオン', defaultAccountId: 9, counterpartyGroupId: 1 })],
      accountNameById: new Map([[9, '食費']]),
      patternCountById: new Map(),
    })

    expect(categories).toEqual([{ key: 'counterparty', name: 'すべての取引先' }])
    expect(nodes.find((n) => n.id === leafNodeId(2))).toMatchObject({
      category: 'counterparty',
      parentId: groupNodeId(1),
      cells: ['食費', '有効'],
    })
  })

  it('登録済みパターンがあれば、名称の横の補足に件数を出す', () => {
    const { nodes } = buildCounterpartyTree({
      groups: [],
      counterparties: [counterparty({ id: 2, name: 'イオン' }), counterparty({ id: 3, name: 'Amazon' })],
      accountNameById: new Map(),
      patternCountById: new Map([[2, 3]]),
    })

    expect(nodes.find((n) => n.id === leafNodeId(2))!.note).toBe('パターン3件')
    expect(nodes.find((n) => n.id === leafNodeId(3))!.note).toBeUndefined()
  })
})

describe('buildProjectTree', () => {
  it('区分は「すべてのプロジェクト」の1つだけで、状態を列に出す', () => {
    const group: ProjectGroup = { id: 1, name: '旅行', parentGroupId: null, sortOrder: 0, isActive: true, ...stamp }
    const project: Project = {
      id: 2,
      name: '沖縄旅行',
      projectGroupId: 1,
      sortOrder: 0,
      isActive: false,
      ...stamp,
    }

    const { categories, nodes } = buildProjectTree({ groups: [group], projects: [project] })

    expect(categories).toEqual([{ key: 'project', name: 'すべてのプロジェクト' }])
    expect(nodes.find((n) => n.id === leafNodeId(2))).toMatchObject({
      parentId: groupNodeId(1),
      cells: ['無効'],
    })
  })
})
