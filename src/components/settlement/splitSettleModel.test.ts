/**
 * splitSettleModel(割勘・精算画面の表示用の変換、計画Issue #153)のユニットテスト。
 * 分担相手の選択ツリー(世帯メンバーと取引先をグループつきで1つの木に並べる)の組み立てと、
 * 選んだ値(m:ID / c:ID)の読み書き、割勘履歴の状態・相手の表示用の組み立てを検証する。
 * DB・DOM非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { buildPartnerCategories, parsePartnerValue, toPartnerValue } from './splitSettleModel'

const counterpartyCategories: TreeSelectCategory[] = [
  {
    key: 'counterparty',
    name: 'すべての取引先',
    nodes: [
      {
        kind: 'group',
        id: '5',
        name: '友人',
        children: [{ kind: 'item', value: '9', name: '友人A', isActive: true }],
      },
      { kind: 'item', value: '10', name: 'イオン', isActive: true },
    ],
  },
]

describe('buildPartnerCategories', () => {
  it('世帯メンバーと世帯外(取引先)を区分に分け、グループの構造を保つ', () => {
    const categories = buildPartnerCategories(
      [
        { id: 1, name: '夫' },
        { id: 2, name: '妻' },
      ],
      counterpartyCategories,
    )

    expect(categories.map((c) => c.name)).toEqual(['世帯メンバー', '世帯外(取引先)'])
    expect(categories[0].nodes).toEqual([
      { kind: 'item', value: 'm:1', name: '夫', isActive: true },
      { kind: 'item', value: 'm:2', name: '妻', isActive: true },
    ])
    const group = categories[1].nodes[0]
    expect(group).toMatchObject({ kind: 'group', name: '友人' })
    expect(group.kind === 'group' && group.children[0]).toEqual({ kind: 'item', value: 'c:9', name: '友人A', isActive: true })
    expect(categories[1].nodes[1]).toEqual({ kind: 'item', value: 'c:10', name: 'イオン', isActive: true })
  })

  it('除外した世帯メンバー(立替者)は選択肢に出さない', () => {
    const categories = buildPartnerCategories(
      [
        { id: 1, name: '夫' },
        { id: 2, name: '妻' },
      ],
      counterpartyCategories,
      new Set([1]),
    )

    expect(categories[0].nodes.map((n) => n.kind === 'item' && n.name)).toEqual(['妻'])
  })
})

describe('parsePartnerValue / toPartnerValue', () => {
  it('m:ID は世帯メンバー、c:ID は世帯外の相手として読む', () => {
    expect(parsePartnerValue('m:2')).toEqual({ kind: 'householdMember', targetId: 2 })
    expect(parsePartnerValue('c:9')).toEqual({ kind: 'counterparty', targetId: 9 })
  })

  it('空文字や不正な値は未選択(targetId が null)として読む', () => {
    expect(parsePartnerValue('')).toEqual({ kind: 'householdMember', targetId: null })
    expect(parsePartnerValue('x:1')).toEqual({ kind: 'householdMember', targetId: null })
  })

  it('行の種類と相手から選択ツリーの値に戻せる', () => {
    expect(toPartnerValue({ kind: 'householdMember', targetId: 2 })).toBe('m:2')
    expect(toPartnerValue({ kind: 'counterparty', targetId: 9 })).toBe('c:9')
    expect(toPartnerValue({ kind: 'counterparty', targetId: null })).toBe('')
  })
})
