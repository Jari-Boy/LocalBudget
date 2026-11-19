/**
 * 選択ツリーの表示行を組み立てる純粋関数(buildTreeSelectRows)の、お気に入り(計画Issue #231 フェーズ4)のテスト。
 * お気に入りがあるとき、先頭に「★ お気に入り」の見出しと、お気に入りの項目を(グループ無しで)並べ、そのあとに従来のツリーを出すこと、
 * お気に入りの並びがツリーの表示順に従うこと、検索語での絞り込み・無効な項目の扱い・複数選択の状態がお気に入りのセクションでも
 * 通常の行と同じ規則になること、お気に入りが無いときは従来の行のままであることを検証する。
 * 外部依存なし(DB・DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import { buildTreeSelectRows, FAVORITES_CATEGORY_NAME, type TreeSelectCategory } from './treeSelectModel'

const item = (value: string, isActive = true) => ({ kind: 'item' as const, value, name: value, isActive })
const group = (id: string, name: string, children: unknown[]) => ({
  kind: 'group' as const,
  id,
  name,
  children: children as never[],
})

const expense: TreeSelectCategory = {
  key: 'expense',
  name: '費用',
  nodes: [
    group('food', '食費', [item('外食'), item('食料品')]),
    group('living', '住居', [group('utility', '光熱費', [item('電気'), item('ガス')]), item('家賃')]),
    item('雑費'),
  ],
}
const revenue: TreeSelectCategory = { key: 'revenue', name: '収益', nodes: [item('給与')] }

const build = (favorites: readonly string[] | undefined, overrides: Partial<Parameters<typeof buildTreeSelectRows>[0]> = {}) =>
  buildTreeSelectRows({
    categories: [expense, revenue],
    selectedValue: '',
    query: '',
    openOverrides: {},
    favoriteValues: favorites === undefined ? undefined : new Set(favorites),
    ...overrides,
  })

/** 項目の行を「セクション:名称」で並べる */
const items = (rows: ReturnType<typeof buildTreeSelectRows>) =>
  rows.flatMap((r) => (r.type === 'item' ? [`${r.section}:${r.name}`] : []))

describe('buildTreeSelectRows: お気に入り', () => {
  it('お気に入りが無い(未指定・空)ときは、お気に入りのセクションを出さず、従来の行のまま(項目はすべてツリーの行で、★は付かない)', () => {
    for (const favorites of [undefined, []]) {
      const rows = build(favorites)
      expect(rows.some((r) => r.type === 'category' && r.name === FAVORITES_CATEGORY_NAME)).toBe(false)
      // 食費・住居のグループは閉じているので、ツリーの行に出るのは雑費と給与の2件
      expect(rows.flatMap((r) => (r.type === 'item' ? [[r.section, r.isFavorite]] : []))).toEqual([
        ['tree', false],
        ['tree', false],
      ])
    }
  })

  it('お気に入りがあると、先頭に「★ お気に入り」の見出しと、お気に入りの項目を(グループ無しで)並べ、そのあとに従来のツリーを出す。お気に入りはツリーの本来の位置にも出る', () => {
    const rows = build(['外食', '給与'])

    expect(rows[0]).toEqual({ type: 'category', name: FAVORITES_CATEGORY_NAME })
    // 外食は、閉じているグループの中なので、ツリーの側には出ない(お気に入りのセクションには、開閉に関係なく出る)
    expect(items(rows)).toEqual(['favorite:外食', 'favorite:給与', 'tree:雑費', 'tree:給与'])
    expect(rows.filter((r) => r.type === 'group').map((r) => r.name)).toEqual(['食費', '住居'])
  })

  it('お気に入りの並びは、ツリーの表示順(区分の順・グループの中の順)に従う', () => {
    const rows = build(['給与', '家賃', '電気', '外食'])

    expect(items(rows).filter((i) => i.startsWith('favorite:'))).toEqual([
      'favorite:外食',
      'favorite:電気',
      'favorite:家賃',
      'favorite:給与',
    ])
  })

  it('項目の行は、お気に入りの状態(isFavorite)を持つ。お気に入りのセクションの行も、ツリーの行も同じ', () => {
    const rows = build(['雑費'])

    const byKey = Object.fromEntries(rows.flatMap((r) => (r.type === 'item' ? [[`${r.section}:${r.name}`, r.isFavorite]] : [])))
    expect(byKey).toEqual({ 'favorite:雑費': true, 'tree:雑費': true, 'tree:給与': false })
  })

  it('お気に入りがあるとき、区分が1つだけでも、従来のツリーの先頭に区分の見出しを出す(お気に入りと区別できる)', () => {
    const rows = buildTreeSelectRows({
      categories: [revenue],
      selectedValue: '',
      query: '',
      openOverrides: {},
      favoriteValues: new Set(['給与']),
    })

    expect(rows.filter((r) => r.type === 'category').map((r) => r.name)).toEqual([FAVORITES_CATEGORY_NAME, '収益'])
  })

  it('検索語があると、お気に入りも同じ検索語(名称に含む)で絞り込み、1件も残らなければセクションごと出さない', () => {
    const matched = build(['外食', '給与'], { query: '食' })
    expect(items(matched).filter((i) => i.startsWith('favorite:'))).toEqual(['favorite:外食'])

    const none = build(['給与'], { query: '食' })
    expect(none.some((r) => r.type === 'category' && r.name === FAVORITES_CATEGORY_NAME)).toBe(false)
  })

  it('無効な項目は、選択中のもの以外は、お気に入りのセクションにも出さない', () => {
    const inactive: TreeSelectCategory = { key: 'x', name: '費用', nodes: [item('旧費目', false), item('新費目')] }
    const favoriteValues = new Set(['旧費目', '新費目'])
    const base = { categories: [inactive], query: '', openOverrides: {}, favoriteValues }

    const notSelected = buildTreeSelectRows({ ...base, selectedValue: '' })
    expect(items(notSelected).filter((i) => i.startsWith('favorite:'))).toEqual(['favorite:新費目'])

    const selected = buildTreeSelectRows({ ...base, selectedValue: '旧費目' })
    expect(items(selected).filter((i) => i.startsWith('favorite:'))).toEqual(['favorite:旧費目', 'favorite:新費目'])
  })

  it('お気に入りのセクションの項目も、選択中のとき isSelected になり、選択したグループの配下なら、グループ経由で対象と示す(複数選択)', () => {
    const rows = buildTreeSelectRows({
      categories: [expense],
      selectedValue: '',
      selectedValues: ['外食', 'g:living'],
      query: '',
      openOverrides: {},
      favoriteValues: new Set(['外食', '家賃']),
    })

    const favorites = rows.flatMap((r) => (r.type === 'item' && r.section === 'favorite' ? [r] : []))
    expect(favorites.map((r) => [r.name, r.isSelected, r.isViaGroup])).toEqual([
      ['外食', true, false],
      ['家賃', false, true],
    ])
  })
})
