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
import type { JournalTemplate } from '../../domain/journal-template/JournalTemplate'
import type { JournalTemplateGroup } from '../../domain/journal-template-group/JournalTemplateGroup'
import type { Project } from '../../domain/project/Project'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import {
  buildAccountTree,
  buildCounterpartyTree,
  buildJournalTemplateTree,
  buildProjectTree,
  groupNodeId,
  leafNodeId,
  parseNodeId,
} from './masterTreeNodes'

const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }

function account(overrides: Partial<Account> & Pick<Account, 'id' | 'name' | 'category'>): Account {
  return {
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
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
    counterpartyGroupId: null,
    sortOrder: 0,
    isActive: true,
    ...stamp,
    ...overrides,
  })

  it('区分は「すべての取引先」の1つだけで、キーワードの件数と状態を列に出す(既定の科目の列は無い)', () => {
    const { categories, nodes } = buildCounterpartyTree({
      groups: [group({ id: 1, name: 'スーパー' })],
      counterparties: [counterparty({ id: 2, name: 'イオン', counterpartyGroupId: 1 })],
      patternCountById: new Map([[2, 3]]),
    })

    expect(categories).toEqual([{ key: 'counterparty', name: 'すべての取引先' }])
    expect(nodes.find((n) => n.id === leafNodeId(2))).toMatchObject({
      category: 'counterparty',
      parentId: groupNodeId(1),
      cells: ['3件', '有効'],
    })
  })

  it('キーワードが無い取引先は、キーワードの列を空にする', () => {
    const { nodes } = buildCounterpartyTree({
      groups: [],
      counterparties: [counterparty({ id: 2, name: 'イオン' })],
      patternCountById: new Map(),
    })

    expect(nodes.find((n) => n.id === leafNodeId(2))!.cells).toEqual(['', '有効'])
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

describe('buildJournalTemplateTree(計画Issue #201)', () => {
  const group: JournalTemplateGroup = { id: 1, name: '食事', parentGroupId: null, sortOrder: 0, isActive: true, ...stamp }
  const line = (lineNo: number, side: 'debit' | 'credit', accountId: number, amount: number | null) => ({
    lineNo,
    side,
    accountId,
    amount,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
  })
  const template = (
    id: number,
    name: string,
    amounts: [number | null, number | null],
    overrides: Partial<JournalTemplate> = {},
  ): JournalTemplate => ({
    id,
    name,
    memo: null,
    bookkeeperHouseholdMemberId: null,
    groupId: 1,
    sortOrder: id,
    isActive: true,
    lines: [line(1, 'debit', 1, amounts[0]), line(2, 'credit', 2, amounts[1])],
    ...stamp,
    ...overrides,
  })
  const accountNameById = new Map([
    [1, '食費'],
    [2, '現金'],
  ])

  it('区分は「すべてのテンプレート」の1つだけで、内容・金額・状態を列に出す', () => {
    const { categories, nodes } = buildJournalTemplateTree({
      groups: [group],
      templates: [template(1, 'コンビニ', [null, null]), template(2, 'ジム', [8800, 8800], { isActive: false })],
      accountNameById,
    })

    expect(categories).toEqual([{ key: 'journalTemplate', name: 'すべてのテンプレート' }])
    expect(nodes.find((n) => n.id === groupNodeId(1))).toMatchObject({ kind: 'group', cells: ['', '', ''] })
    expect(nodes.find((n) => n.id === leafNodeId(1))).toMatchObject({
      parentId: groupNodeId(1),
      cells: ['食費 / 現金', '起票時に入力', '有効'],
    })
    expect(nodes.find((n) => n.id === leafNodeId(2))).toMatchObject({ cells: ['食費 / 現金', '￥8,800', '無効'] })
  })

  it('一部の行だけ金額があるテンプレートの金額は「一部入力」と表す', () => {
    const { nodes } = buildJournalTemplateTree({
      groups: [],
      templates: [template(1, 'A', [500, null], { groupId: null })],
      accountNameById,
    })

    expect(nodes[0]).toMatchObject({ parentId: null, cells: ['食費 / 現金', '一部入力', '有効'] })
  })

  it('グループとテンプレートを並び順で混在させ、現在の並び順をidごとに返す', () => {
    const { nodes, sortOrders } = buildJournalTemplateTree({
      groups: [{ ...group, sortOrder: 5 }],
      templates: [
        template(1, 'A', [null, null], { groupId: null, sortOrder: 2 }),
        template(2, 'B', [null, null], { groupId: null, sortOrder: 9 }),
      ],
      accountNameById,
    })

    expect(nodes.map((n) => n.id)).toEqual([leafNodeId(1), groupNodeId(1), leafNodeId(2)])
    expect(sortOrders.get(groupNodeId(1))).toBe(5)
  })
})
