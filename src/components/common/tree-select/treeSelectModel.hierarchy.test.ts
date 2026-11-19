/**
 * buildTreeSelectRows の「階層つきの項目(depth・parentValue)」と、検索の正規化のテスト(計画Issue #233)。
 * グループを選ぶ欄のように項目だけで階層を表すとき、深さに応じてインデントし、検索で親が絞り落とされたら
 * 押せない見出し行(context)として親を残す。検索はひらがな・カタカナ等の違いを区別しない。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildTreeSelectRows, type TreeSelectCategory } from './treeSelectModel'

const item = (value: string, name: string, depth: number, parentValue: string | null, isActive = true) => ({
  kind: 'item' as const,
  value,
  name,
  isActive,
  depth,
  parentValue,
})

const categories: TreeSelectCategory[] = [
  {
    key: 'groups',
    name: 'グループ',
    nodes: [
      item('1', '日用品・雑貨', 0, null),
      item('2', 'ドラッグストア', 1, '1'),
      item('3', '家電', 1, '1'),
      item('4', '食費', 0, null),
    ],
  },
]

const rows = (query: string, selectedValue = '') =>
  buildTreeSelectRows({ categories, selectedValue, query, openOverrides: {} })

describe('buildTreeSelectRows(階層つきの項目)', () => {
  it('検索なしでは、深さ1段ごとに16pxインデントして親子の順に並べる', () => {
    expect(rows('').map((r) => r.type === 'item' && [r.name, r.indent])).toEqual([
      ['日用品・雑貨', 8],
      ['ドラッグストア', 24],
      ['家電', 24],
      ['食費', 8],
    ])
  })

  it('検索で子だけがヒットしたら、絞り落とされた親を押せない見出し行(context)として残す', () => {
    expect(rows('らっぐ').map((r) => (r.type === 'context' ? ['context', r.name, r.indent] : r.type === 'item' ? ['item', r.name, r.indent] : r.type))).toEqual([
      ['context', '日用品・雑貨', 8],
      ['item', 'ドラッグストア', 24],
    ])
  })

  it('親もヒットしているときは、親を通常の項目として出し、見出し行を重ねない', () => {
    const result = rows('日用品')
    expect(result.filter((r) => r.type === 'context')).toHaveLength(0)
    expect(result.some((r) => r.type === 'item' && r.name === '日用品・雑貨')).toBe(true)
  })

  it('同じ親の子が複数ヒットしても、見出し行は1回だけ出す', () => {
    const result = buildTreeSelectRows({
      categories: [{ key: 'g', name: 'g', nodes: [item('1', '親', 0, null), item('2', 'あ子', 1, '1'), item('3', 'あ孫', 1, '1')] }],
      selectedValue: '',
      query: 'あ',
      openOverrides: {},
    })
    expect(result.filter((r) => r.type === 'context')).toHaveLength(1)
  })

  it('深さ2の項目だけがヒットしたら、祖先を上から順に見出し行で残す', () => {
    const result = buildTreeSelectRows({
      categories: [{ key: 'g', name: 'g', nodes: [item('1', 'A', 0, null), item('2', 'B', 1, '1'), item('3', 'ねこ', 2, '2')] }],
      selectedValue: '',
      query: 'ネコ',
      openOverrides: {},
    })
    expect(result.map((r) => r.type === 'context' || r.type === 'item' ? [r.type, r.name, r.indent] : r.type)).toEqual([
      ['context', 'A', 8],
      ['context', 'B', 24],
      ['item', 'ねこ', 40],
    ])
  })

  it('非アクティブな項目は選択中でなければ出さず、選択中なら出す', () => {
    const cats: TreeSelectCategory[] = [{ key: 'g', name: 'g', nodes: [item('1', '旧', 0, null, false)] }]
    const build = (selectedValue: string) => buildTreeSelectRows({ categories: cats, selectedValue, query: '', openOverrides: {} })
    expect(build('')).toEqual([])
    expect(build('1')).toHaveLength(1)
  })
})

describe('buildTreeSelectRows(検索の正規化)', () => {
  it('ひらがなの検索語でカタカナの項目にヒットする', () => {
    const result = rows('どらっぐ')
    expect(result.some((r) => r.type === 'item' && r.name === 'ドラッグストア')).toBe(true)
  })

  it('グループつきのノードでも、ひらがなでカタカナの項目にヒットする', () => {
    const result = buildTreeSelectRows({
      categories: [{ key: 'c', name: 'c', nodes: [{ kind: 'group', id: 'g', name: 'G', children: [{ kind: 'item', value: '9', name: 'サンドラッグ', isActive: true }] }] }],
      selectedValue: '',
      query: 'さんどらっぐ',
      openOverrides: {},
    })
    expect(result.some((r) => r.type === 'item' && r.value === '9')).toBe(true)
  })
})
