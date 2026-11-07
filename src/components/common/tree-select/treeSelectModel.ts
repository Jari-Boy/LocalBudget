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
  /** 配下の表示対象の項目数(入れ子を含む) */
  count: number
}

export interface TreeSelectItemRow {
  type: 'item'
  value: string
  name: string
  indent: number
  isSelected: boolean
}

export type TreeSelectRow = TreeSelectCategoryRow | TreeSelectGroupRow | TreeSelectItemRow

export interface BuildTreeSelectRowsInput {
  categories: readonly TreeSelectCategory[]
  /** 選択中の値(項目の値、または「g:グループID」。未選択は空文字) */
  selectedValue: string
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
  query,
  openOverrides,
}: BuildTreeSelectRowsInput): TreeSelectRow[] {
  const q = query.trim()
  const isVisibleItem = (node: TreeSelectItemNode) =>
    (q === '' || node.name.includes(q)) && (node.isActive || node.value === selectedValue)

  const visibleItemsOf = (nodes: readonly TreeSelectNode[]): TreeSelectItemNode[] =>
    nodes.flatMap((node) =>
      node.kind === 'group' ? visibleItemsOf(node.children) : isVisibleItem(node) ? [node] : [],
    )

  const walk = (nodes: readonly TreeSelectNode[], depth: number): TreeSelectRow[] =>
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
                isSelected: node.value === selectedValue,
              },
            ]
          : []
      }
      const items = visibleItemsOf(node.children)
      if (items.length === 0) return []
      const isOpen =
        q !== '' ? true : (openOverrides[node.id] ?? items.some((item) => item.value === selectedValue))
      return [
        {
          type: 'group',
          id: node.id,
          name: node.name,
          value: `${GROUP_VALUE_PREFIX}${node.id}`,
          indent,
          isOpen,
          count: items.length,
        },
        ...(isOpen ? walk(node.children, depth + 1) : []),
      ]
    })

  return categories.flatMap((category) => {
    const rows = walk(category.nodes, 0)
    if (rows.length === 0) return []
    return categories.length > 1 ? [{ type: 'category' as const, name: category.name }, ...rows] : rows
  })
}
