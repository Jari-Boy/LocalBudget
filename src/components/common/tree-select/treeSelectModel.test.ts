/**
 * 選択ツリーの表示行を組み立てる純粋関数(buildTreeSelectRows)のテスト(計画Issue #150)。
 * 区分の見出し・入れ子グループ・検索・無効項目の除外・開閉の初期状態を検証する。
 * 科目・取引先・プロジェクトで共通に使うため、ドメインの型には依存せず汎用のノード型だけを使う。
 * 外部依存なし(DB・DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import { buildTreeSelectRows, type TreeSelectCategory } from './treeSelectModel'

const item = (value: string, name = value, isActive = true) => ({
  kind: 'item' as const,
  value,
  name,
  isActive,
})
const group = (id: string, name: string, children: ReturnType<typeof item>[] | unknown[]) => ({
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

const labels = (rows: ReturnType<typeof buildTreeSelectRows>) =>
  rows.map((r) => `${r.type}:${r.type === 'category' ? r.name : r.name}`)

describe('buildTreeSelectRows', () => {
  it('区分が複数あるときは区分の見出し行を出し、1つだけのときは出さない', () => {
    const multi = buildTreeSelectRows({ categories: [expense, revenue], selectedValue: '', query: '', openOverrides: {} })
    expect(multi.filter((r) => r.type === 'category').map((r) => r.name)).toEqual(['費用', '収益'])

    const single = buildTreeSelectRows({ categories: [revenue], selectedValue: '', query: '', openOverrides: {} })
    expect(single.some((r) => r.type === 'category')).toBe(false)
  })

  it('選択中の項目を含むグループだけを最初から開き、他のグループは閉じる', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '電気', query: '', openOverrides: {} })
    const groups = rows.filter((r) => r.type === 'group')
    expect(groups.map((g) => [g.name, g.isOpen])).toEqual([
      ['食費', false],
      ['住居', true],
      ['光熱費', true],
    ])
    expect(labels(rows)).toContain('item:電気')
    expect(labels(rows)).not.toContain('item:外食')
  })

  it('選択がなければすべてのグループが閉じ、直属の項目だけが見える', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '', query: '', openOverrides: {} })
    expect(labels(rows)).toEqual(['group:食費', 'group:住居', 'item:雑費'])
  })

  it('開閉の操作(openOverrides)は選択中の初期状態より優先される', () => {
    const rows = buildTreeSelectRows({
      categories: [expense],
      selectedValue: '電気',
      query: '',
      openOverrides: { living: false, food: true },
    })
    expect(labels(rows)).toEqual(['group:食費', 'item:外食', 'item:食料品', 'group:住居', 'item:雑費'])
  })

  it('無効な項目は、選択中のものを除いて出さない', () => {
    const cat: TreeSelectCategory = {
      key: 'a',
      name: 'A',
      nodes: [item('使用中'), item('廃止', '廃止', false), item('旧口座', '旧口座', false)],
    }
    const rows = buildTreeSelectRows({ categories: [cat], selectedValue: '旧口座', query: '', openOverrides: {} })
    expect(rows.filter((r) => r.type === 'item').map((r) => r.name)).toEqual(['使用中', '旧口座'])
  })

  it('検索語に一致する項目だけを出し、一致を含むグループは自動で開く', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '', query: '電', openOverrides: {} })
    expect(labels(rows)).toEqual(['group:住居', 'group:光熱費', 'item:電気'])
    expect(rows.filter((r) => r.type === 'group').every((g) => g.isOpen)).toBe(true)
  })

  it('検索中は開閉の操作よりも自動展開を優先する', () => {
    const rows = buildTreeSelectRows({
      categories: [expense],
      selectedValue: '',
      query: 'ガス',
      openOverrides: { living: false },
    })
    expect(labels(rows)).toContain('item:ガス')
  })

  it('一致する項目がない区分は見出しごと出さない', () => {
    const rows = buildTreeSelectRows({ categories: [expense, revenue], selectedValue: '', query: '給', openOverrides: {} })
    expect(labels(rows)).toEqual(['category:収益', 'item:給与'])
  })

  it('グループの件数は、配下の表示対象の項目数(入れ子を含む)', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '', query: '', openOverrides: {} })
    const living = rows.find((r) => r.type === 'group' && r.name === '住居')
    expect(living && living.type === 'group' && living.count).toBe(3)
  })

  it('配下に表示対象の項目がないグループは出さない', () => {
    const cat: TreeSelectCategory = {
      key: 'a',
      name: 'A',
      nodes: [group('empty', '空', []), group('old', '廃止のみ', [item('x', 'x', false)]), item('y')],
    }
    const rows = buildTreeSelectRows({ categories: [cat], selectedValue: '', query: '', openOverrides: {} })
    expect(labels(rows)).toEqual(['item:y'])
  })

  it('入れ子の深さに応じてインデントが増え、項目はグループ見出しより一段深い', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '電気', query: '', openOverrides: {} })
    const indentOf = (name: string) => {
      const row = rows.find((r) => r.type !== 'category' && r.name === name)
      if (!row || row.type === 'category') throw new Error(`行が見つからない: ${name}`)
      return row.indent
    }
    expect(indentOf('住居')).toBe(8)
    expect(indentOf('光熱費')).toBe(24)
    // 項目は自分の深さ(2)のインデント(2*16+8=40)に、開閉マーク分の18pxを足す
    expect(indentOf('電気')).toBe(58)
    expect(indentOf('電気')).toBeGreaterThan(indentOf('光熱費'))
  })

  it('選択中の項目の行にisSelectedが付く', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '雑費', query: '', openOverrides: {} })
    const selected = rows.filter((r) => r.type === 'item' && r.isSelected)
    expect(selected.map((r) => r.name)).toEqual(['雑費'])
  })

  it('グループの値は「g:グループID」で表す', () => {
    const rows = buildTreeSelectRows({ categories: [expense], selectedValue: '', query: '', openOverrides: {} })
    const food = rows.find((r) => r.type === 'group' && r.name === '食費')
    expect(food && food.type === 'group' && food.value).toBe('g:food')
  })
})
