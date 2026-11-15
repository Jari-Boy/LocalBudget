/**
 * 選択ツリーの表示行を組み立てる純粋関数(計画Issue #150)。
 * 科目・取引先・プロジェクトで共通に使うため、ドメインの型には依存せず、
 * 区分(category)・グループ・項目の汎用ノード型だけを扱う。DB・DOM非依存。
 */
export interface TreeSelectItemNode {
  kind: 'item'
  /** 選択時にonChangeへ渡す値 */
  value: string
  name: string
  isActive: boolean
}

export interface TreeSelectGroupNode {
  kind: 'group'
  id: string
  name: string
  children: TreeSelectNode[]
}

export type TreeSelectNode = TreeSelectItemNode | TreeSelectGroupNode

export interface TreeSelectCategory {
  key: string
  name: string
  nodes: TreeSelectNode[]
}

export interface TreeSelectCategoryRow {
  type: 'category'
  name: string
}

export interface TreeSelectGroupRow {
  type: 'group'
  id: string
  name: string
  /** グループごと選択するときの値(「g:グループID」) */
  value: string
  indent: number
  isOpen: boolean
  /** グループ自体が選択中(複数選択でグループごと選んでいる、計画Issue #203) */
  isSelected: boolean
  /** 配下の表示対象の項目数(入れ子を含む) */
  count: number
}

export interface TreeSelectItemRow {
  type: 'item'
  value: string
  name: string
  indent: number
  isSelected: boolean
  /** 選択中のグループの配下であるため対象になっている(項目自体の選択とは別、計画Issue #203) */
  isViaGroup: boolean
}

export type TreeSelectRow = TreeSelectCategoryRow | TreeSelectGroupRow | TreeSelectItemRow

export interface BuildTreeSelectRowsInput {
  categories: readonly TreeSelectCategory[]
  /** 選択中の値(項目の値、または「g:グループID」。未選択は空文字) */
  selectedValue: string
  /** 複数選択の選択中の値(項目の値と「g:グループID」の混在)。渡すとselectedValueより優先する(計画Issue #203) */
  selectedValues?: readonly string[]
  query: string
  /** グループIDごとの開閉の操作。なければ「選択中の項目を含むか」で決める */
  openOverrides: Readonly<Record<string, boolean>>
}

/** グループ値の接頭辞 */
export const GROUP_VALUE_PREFIX = 'g:'

const LEVEL_INDENT = 16
const BASE_INDENT = 8
/** 項目は、グループ見出しの開閉マーク分だけ右にずらして揃える */
const ITEM_MARK_INDENT = 18

export function buildTreeSelectRows({
  categories,
  selectedValue,
  selectedValues,
  query,
  openOverrides,
}: BuildTreeSelectRowsInput): TreeSelectRow[] {
  const q = query.trim()
  const selected = new Set(selectedValues ?? (selectedValue === '' ? [] : [selectedValue]))
  const isVisibleItem = (node: TreeSelectItemNode) =>
    (q === '' || node.name.includes(q)) && (node.isActive || selected.has(node.value))

  const visibleItemsOf = (nodes: readonly TreeSelectNode[]): TreeSelectItemNode[] =>
    nodes.flatMap((node) =>
      node.kind === 'group' ? visibleItemsOf(node.children) : isVisibleItem(node) ? [node] : [],
    )

  const walk = (nodes: readonly TreeSelectNode[], depth: number, viaGroup: boolean): TreeSelectRow[] =>
    nodes.flatMap((node): TreeSelectRow[] => {
      const indent = depth * LEVEL_INDENT + BASE_INDENT
      if (node.kind === 'item') {
        return isVisibleItem(node)
          ? [
              {
                type: 'item',
                value: node.value,
                name: node.name,
                indent: indent + ITEM_MARK_INDENT,
                isSelected: selected.has(node.value),
                isViaGroup: viaGroup,
              },
            ]
          : []
      }
      const items = visibleItemsOf(node.children)
      if (items.length === 0) return []
      const isOpen = q !== '' ? true : (openOverrides[node.id] ?? items.some((item) => selected.has(item.value)))
      const groupValue = `${GROUP_VALUE_PREFIX}${node.id}`
      const isGroupSelected = selected.has(groupValue)
      return [
        {
          type: 'group',
          id: node.id,
          name: node.name,
          value: groupValue,
          indent,
          isOpen,
          isSelected: isGroupSelected,
          count: items.length,
        },
        ...(isOpen ? walk(node.children, depth + 1, viaGroup || isGroupSelected) : []),
      ]
    })

  return categories.flatMap((category) => {
    const rows = walk(category.nodes, 0, false)
    if (rows.length === 0) return []
    return categories.length > 1 ? [{ type: 'category' as const, name: category.name }, ...rows] : rows
  })
}
