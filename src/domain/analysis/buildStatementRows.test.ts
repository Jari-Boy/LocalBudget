/**
 * buildStatementRows(分析画面の財務諸表タブの階層表、計画Issue #155)のユニットテスト。
 * PL・BSの科目別の金額を、マスタの科目グループ(入れ子を含む)の階層で並べた行にする。
 * - グループの行は配下の科目の合計。比較があれば比較列と差額列も持つ
 * - 折りたたんだグループの配下の行は出さない(グループの行の合計は変わらない)
 * - 金額のない科目・グループ(当期も比較も0)は出さない
 * - グループに属さない科目は、グループの後に最上位の行として並べる
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { AccountGroup } from '../account-group/AccountGroup'
import type { AccountAmount } from '../financial-statement/AccountAmount'
import { buildStatementRows } from './buildStatementRows'

function account(id: number, name: string, accountGroupId: number | null, sortOrder = id): Account {
  return {
    id,
    category: 'expense',
    name,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId,
    sortOrder,
    createdAt: '',
    updatedAt: '',
  }
}

function group(id: number, name: string, parentGroupId: number | null, sortOrder = id): AccountGroup {
  return { id, name, parentGroupId, category: 'expense', sortOrder, isActive: true, createdAt: '', updatedAt: '' }
}

const accounts = [
  account(1, '食費', 11),
  account(2, '外食', 11),
  account(3, '日用品', 10, 50),
  account(4, '社会保険料', null),
  account(5, '使っていない科目', 10),
]
const groups = [group(10, '生活', null), group(11, '食', 10, 1)]

const amount = (accountId: number, accountName: string, value: number): AccountAmount => ({
  accountId,
  accountName,
  amount: value,
})

const current = [amount(1, '食費', 30000), amount(2, '外食', 8000), amount(3, '日用品', 5000), amount(4, '社会保険料', 20000)]

describe('buildStatementRows', () => {
  it('グループの階層で、グループ→配下の科目の順に並べ、深さを持つ', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    expect(rows.map((r) => [r.kind, r.name, r.depth])).toEqual([
      ['group', '生活', 0],
      ['group', '食', 1],
      ['account', '食費', 2],
      ['account', '外食', 2],
      ['account', '日用品', 1],
      ['account', '社会保険料', 0],
    ])
  })

  it('グループの行の金額は、入れ子を含む配下の科目の合計になる', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    expect(rows.find((r) => r.name === '食')?.current).toBe(38000)
    expect(rows.find((r) => r.name === '生活')?.current).toBe(43000)
  })

  it('最上位の行の合計は、渡した金額の合計と一致する', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    const top = rows.filter((r) => r.depth === 0).reduce((sum, r) => sum + r.current, 0)
    expect(top).toBe(63000)
  })

  it('金額のない科目と、配下がすべて金額のないグループは出さない', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    expect(rows.some((r) => r.name === '使っていない科目')).toBe(false)
    const onlyUnused = buildStatementRows({ accounts, groups, current: [], comparison: null, collapsedGroupIds: new Set() })
    expect(onlyUnused).toEqual([])
  })

  it('折りたたんだグループの配下は出さず、グループの行の金額は変わらない', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set([11]) })
    expect(rows.map((r) => r.name)).toEqual(['生活', '食', '日用品', '社会保険料'])
    expect(rows.find((r) => r.name === '食')?.current).toBe(38000)
    expect(rows.find((r) => r.name === '食')?.isCollapsed).toBe(true)
  })

  it('科目の行は科目のidを持ち、グループの行はグループのidを持つ', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    expect(rows.find((r) => r.name === '食費')).toMatchObject({ kind: 'account', accountId: 1 })
    expect(rows.find((r) => r.name === '食')).toMatchObject({ kind: 'group', groupId: 11 })
  })

  it('比較があれば、比較の金額と差額(当期−比較)を持つ', () => {
    const comparison = [amount(1, '食費', 25000), amount(3, '日用品', 7000)]
    const rows = buildStatementRows({ accounts, groups, current, comparison, collapsedGroupIds: new Set() })
    const food = rows.find((r) => r.name === '食費')!
    expect([food.current, food.compare, food.difference]).toEqual([30000, 25000, 5000])
    const supplies = rows.find((r) => r.name === '日用品')!
    expect([supplies.compare, supplies.difference]).toEqual([7000, -2000])
  })

  it('当期になく比較にだけある科目も、当期0円として出す', () => {
    const comparison = [amount(5, '使っていない科目', 1200)]
    const rows = buildStatementRows({ accounts, groups, current, comparison, collapsedGroupIds: new Set() })
    const unused = rows.find((r) => r.name === '使っていない科目')!
    expect([unused.current, unused.compare, unused.difference]).toEqual([0, 1200, -1200])
  })

  it('比較がなければ、比較の金額と差額はnull', () => {
    const rows = buildStatementRows({ accounts, groups, current, comparison: null, collapsedGroupIds: new Set() })
    expect(rows[0].compare).toBeNull()
    expect(rows[0].difference).toBeNull()
  })

  it('グループ内の並びは、グループと科目をsortOrderで混在させる', () => {
    const mixed = [account(1, '食費', 11, 5), account(2, '外食', 11, 1)]
    const rows = buildStatementRows({
      accounts: mixed,
      groups: [group(11, '食', null)],
      current: [amount(1, '食費', 1), amount(2, '外食', 2)],
      comparison: null,
      collapsedGroupIds: new Set(),
    })
    expect(rows.filter((r) => r.kind === 'account').map((r) => r.name)).toEqual(['外食', '食費'])
  })
})
