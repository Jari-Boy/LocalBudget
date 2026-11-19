/**
 * buildTreeSelectRows の階層つき項目の開閉(計画Issue #234)のテスト。
 * 子を持つ項目は、既定では子孫を畳み(選択中の項目の祖先だけ開く)、開閉の操作で切り替えられ、
 * 検索中は該当する項目まですべて展開されることを検証する。外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import { buildTreeSelectRows, type TreeSelectCategory, type TreeSelectItemRow } from './treeSelectModel'

const item = (value: string, name: string, depth: number, parentValue: string | null) => ({
  kind: 'item' as const,
  value,
  name,
  isActive: true,
  depth,
  parentValue,
  pathName: name,
})

/** 食費 > 外食 > ランチ、食費 > 自炊、住居 */
const categories: TreeSelectCategory[] = [
  {
    key: 'groups',
    name: 'グループ',
    nodes: [item('1', '食費', 0, null), item('2', '外食', 1, '1'), item('3', 'ランチ', 2, '2'), item('4', '自炊', 1, '1'), item('5', '住居', 0, null)],
  },
]

const build = (extra: { selectedValue?: string; query?: string; openOverrides?: Record<string, boolean> } = {}) =>
  buildTreeSelectRows({ categories, selectedValue: '', query: '', openOverrides: {}, ...extra })
const itemRows = (rows: ReturnType<typeof build>) => rows.filter((r): r is TreeSelectItemRow => r.type === 'item')
const names = (rows: ReturnType<typeof build>) => itemRows(rows).map((r) => r.name)

describe('階層つき項目の開閉', () => {
  it('既定では、最上位の項目だけが並び、子を持つ項目は閉じている', () => {
    const rows = itemRows(build())
    expect(rows.map((r) => [r.name, r.fold])).toEqual([
      ['食費', 'closed'],
      ['住居', 'leaf'],
    ])
  })

  it('選択中の項目の祖先は開き、その兄弟と祖先の兄弟も並ぶ(ほかの子孫は畳んだまま)', () => {
    const rows = itemRows(build({ selectedValue: '3' }))
    expect(rows.map((r) => [r.name, r.fold])).toEqual([
      ['食費', 'open'],
      ['外食', 'open'],
      ['ランチ', 'leaf'],
      ['自炊', 'leaf'],
      ['住居', 'leaf'],
    ])
  })

  it('開閉の操作(h:値)で、閉じた項目を開き、開いた項目を閉じられる', () => {
    expect(names(build({ openOverrides: { 'h:1': true } }))).toEqual(['食費', '外食', '自炊', '住居'])
    expect(names(build({ selectedValue: '3', openOverrides: { 'h:1': false } }))).toEqual(['食費', '住居'])
  })

  it('開いた項目の子の深さに応じて、インデントが付く', () => {
    const rows = itemRows(build({ openOverrides: { 'h:1': true, 'h:2': true } }))
    expect(rows.map((r) => r.indent)).toEqual([8, 24, 40, 24, 8])
  })

  it('検索中は、該当する項目まですべて展開され、開閉の印は付かない', () => {
    const rows = build({ query: 'ランチ' })
    expect(rows.map((r) => (r.type === 'context' ? `ctx:${r.name}` : r.type === 'item' ? `item:${r.name}` : r.type))).toEqual([
      'ctx:食費',
      'ctx:外食',
      'item:ランチ',
    ])
    expect(itemRows(rows)[0].fold).toBeUndefined()
  })
})
