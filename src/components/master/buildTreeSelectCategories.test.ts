/**
 * buildTreeSelectCategories(計画Issue #154)のテスト。
 * マスタのツリー(科目・取引先・プロジェクト)を、選択ツリー(TreeSelect)が受け取る
 * 区分・グループ・項目のノードに変換する純粋関数を検証する。項目の値はドメインのid(文字列)、
 * グループのidはドメインのid(「g:」はTreeSelect側で付く)、無効な項目の印、区分の構造と
 * 入れ子が保たれることを確認する。DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Account } from '../../domain/account/Account'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { buildAccountTree } from './masterTreeNodes'

const stamp = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }

const groups: AccountGroup[] = [
  { id: 1, name: 'カード', parentGroupId: null, category: 'liability', sortOrder: 0, isActive: true, ...stamp },
  { id: 2, name: '夫名義', parentGroupId: 1, category: 'liability', sortOrder: 0, isActive: true, ...stamp },
]
const accounts: Account[] = [
  {
    id: 10, category: 'liability', name: '楽天VISA', isReconcilable: false, hasExternalStatement: false, isActive: true,
    isSystemManaged: false, householdMemberId: null, accountGroupId: 2, sortOrder: 0, ...stamp,
  },
  {
    id: 11, category: 'expense', name: '食費', isReconcilable: null, hasExternalStatement: null, isActive: false,
    isSystemManaged: false, householdMemberId: null, accountGroupId: null, sortOrder: 0, ...stamp,
  },
]
const tree = buildAccountTree({ groups, accounts, memberNameById: new Map() })

describe('buildTreeSelectCategories', () => {
  it('区分ごとに、区分のkeyと名前を保ったカテゴリを返す', () => {
    const categories = buildTreeSelectCategories(tree, new Set())

    expect(categories.map((c) => [c.key, c.name])).toContainEqual(['liability', '負債'])
    expect(categories.map((c) => c.key)).toEqual(['asset', 'liability', 'expense', 'revenue', 'equity'])
  })

  it('入れ子のグループと項目を、そのままの構造で返し、項目の値はドメインのidになる', () => {
    const liability = buildTreeSelectCategories(tree, new Set()).find((c) => c.key === 'liability')!

    expect(liability.nodes).toEqual([
      {
        kind: 'group',
        id: '1',
        name: 'カード',
        children: [
          {
            kind: 'group',
            id: '2',
            name: '夫名義',
            children: [{ kind: 'item', value: '10', name: '楽天VISA', isActive: true }],
          },
        ],
      },
    ])
  })

  it('無効な項目は、isActiveがfalseになる', () => {
    const expense = buildTreeSelectCategories(tree, new Set([11])).find((c) => c.key === 'expense')!

    expect(expense.nodes).toEqual([{ kind: 'item', value: '11', name: '食費', isActive: false }])
  })
})
