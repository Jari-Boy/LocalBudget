import { matchesSearch } from './normalizeForSearch'

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
  /**
   * 階層つきの項目(グループを選ぶ欄、計画Issue #233 案A)。深さ(最上位が0)。渡すと、グループ見出しを使わず、
   * 項目だけをフラットに、深さに応じてインデントして並べる。親は直前までに並ぶ項目のparentValueで指す
   */
  depth?: number
  /** 親の項目の値(最上位はnull)。検索で親が絞り落とされたとき、見出し行として残すために使う */
  parentValue?: string | null
  /** 「親 > 子」のパス表示名。閉じた状態で同名の項目を区別するときに使う */
  pathName?: string
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
  /** 先頭の「★ お気に入り」のセクションの行か、従来のツリーの行か(同じ項目が両方に出るので、行の区別に使う、計画Issue #231 フェーズ4) */
  section: 'favorite' | 'tree'
  /** お気に入りか(★の状態) */
  isFavorite: boolean
  /**
   * 階層つきの項目の開閉(計画Issue #234)。子を持つ項目は開いている(open)か閉じている(closed)か、子を持たない項目はleaf。
   * 階層つきではない項目と、検索中の行には付かない。開閉の操作は、openOverridesの「h:値」で持つ
   */
  fold?: 'open' | 'closed' | 'leaf'
}

/** 検索で親が絞り落とされたとき、階層が追えるように残す親の見出し行(押せない、計画Issue #233) */
export interface TreeSelectContextRow {
  type: 'context'
  name: string
  indent: number
}

export type TreeSelectRow = TreeSelectCategoryRow | TreeSelectGroupRow | TreeSelectItemRow | TreeSelectContextRow

export interface BuildTreeSelectRowsInput {
  categories: readonly TreeSelectCategory[]
  /** 選択中の値(項目の値、または「g:グループID」。未選択は空文字) */
  selectedValue: string
  /** 複数選択の選択中の値(項目の値と「g:グループID」の混在)。渡すとselectedValueより優先する(計画Issue #203) */
  selectedValues?: readonly string[]
  query: string
  /** グループIDごとの開閉の操作(階層つきの項目は「h:値」)。なければ「選択中の項目を含むか」で決める */
  openOverrides: Readonly<Record<string, boolean>>
  /**
   * お気に入りの項目の値(計画Issue #231 フェーズ4)。表示できる項目が1件でもあれば、先頭に「★ お気に入り」のセクションを
   * (グループ無しで、ツリーの表示順に)出す。ツリーの側にも、本来の位置に従来どおり出す
   */
  favoriteValues?: ReadonlySet<string>
}

/** お気に入りのセクションの見出し */
export const FAVORITES_CATEGORY_NAME = '★ お気に入り'

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
  favoriteValues,
}: BuildTreeSelectRowsInput): TreeSelectRow[] {
  const q = query.trim()
  const selected = new Set(selectedValues ?? (selectedValue === '' ? [] : [selectedValue]))
  const isVisibleItem = (node: TreeSelectItemNode) =>
    matchesSearch(node.name, q) && (node.isActive || selected.has(node.value))

  const visibleItemsOf = (nodes: readonly TreeSelectNode[]): TreeSelectItemNode[] =>
    nodes.flatMap((node) =>
      node.kind === 'group' ? visibleItemsOf(node.children) : isVisibleItem(node) ? [node] : [],
    )

  const isFavorite = (value: string) => favoriteValues?.has(value) ?? false

  /** お気に入りのセクションの行。グループの開閉に関係なく、表示できる項目すべてを、ツリーの表示順に集める */
  const collectFavorites = (nodes: readonly TreeSelectNode[], viaGroup: boolean): TreeSelectItemRow[] =>
    nodes.flatMap((node): TreeSelectItemRow[] => {
      if (node.kind === 'group') {
        const isGroupSelected = selected.has(`${GROUP_VALUE_PREFIX}${node.id}`)
        return collectFavorites(node.children, viaGroup || isGroupSelected)
      }
      return isVisibleItem(node) && isFavorite(node.value)
        ? [
            {
              type: 'item',
              value: node.value,
              name: node.name,
              indent: BASE_INDENT,
              isSelected: selected.has(node.value),
              isViaGroup: viaGroup,
              section: 'favorite',
              isFavorite: true,
            },
          ]
        : []
    })

  // 階層つきの項目(depth付き)。検索で親が絞り落とされたら、祖先を上から順に押せない見出し行として、1回だけ残す
  const hierarchicalIndent = (depth: number) => BASE_INDENT + depth * LEVEL_INDENT
  const contextEmitted = new Set<string>()
  const emittedItems = new Set<string>()
  const itemsByValue = new Map<string, TreeSelectItemNode>()
  for (const category of categories) {
    for (const node of category.nodes) if (node.kind === 'item') itemsByValue.set(node.value, node)
  }
  // 階層つきの項目の開閉。子を持つ項目の値と、選択中の項目の祖先(既定で開く)
  const parentValues = new Set<string>()
  for (const node of itemsByValue.values()) if (node.depth !== undefined && node.parentValue != null) parentValues.add(node.parentValue)
  const openByDefault = new Set<string>()
  for (const value of selected) {
    let parent = itemsByValue.get(value)?.parentValue
    while (parent != null && !openByDefault.has(parent)) {
      openByDefault.add(parent)
      parent = itemsByValue.get(parent)?.parentValue
    }
  }
  const isFoldOpen = (value: string) => openOverrides[`h:${value}`] ?? openByDefault.has(value)
  const walkHierarchicalItem = (node: TreeSelectItemNode): TreeSelectRow[] => {
    if (!isVisibleItem(node)) return []
    // 畳まれた祖先の下の項目は、検索中でなければ出さない
    if (q === '') {
      let parent = node.parentValue != null ? itemsByValue.get(node.parentValue) : undefined
      while (parent !== undefined) {
        if (!isFoldOpen(parent.value)) return []
        parent = parent.parentValue != null ? itemsByValue.get(parent.parentValue) : undefined
      }
    }
    const rows: TreeSelectRow[] = []
    if (q !== '') {
      const missing: TreeSelectItemNode[] = []
      let parent = node.parentValue != null ? itemsByValue.get(node.parentValue) : undefined
      while (parent !== undefined) {
        if (!emittedItems.has(parent.value) && !contextEmitted.has(parent.value)) missing.unshift(parent)
        parent = parent.parentValue != null ? itemsByValue.get(parent.parentValue) : undefined
      }
      for (const ancestor of missing) {
        contextEmitted.add(ancestor.value)
        rows.push({ type: 'context', name: ancestor.name, indent: hierarchicalIndent(ancestor.depth ?? 0) })
      }
    }
    emittedItems.add(node.value)
    rows.push({
      type: 'item',
      value: node.value,
      name: node.name,
      indent: hierarchicalIndent(node.depth ?? 0),
      isSelected: selected.has(node.value),
      isViaGroup: false,
      section: 'tree',
      isFavorite: isFavorite(node.value),
      ...(q === '' ? { fold: !parentValues.has(node.value) ? ('leaf' as const) : isFoldOpen(node.value) ? ('open' as const) : ('closed' as const) } : {}),
    })
    return rows
  }

  const walk = (nodes: readonly TreeSelectNode[], depth: number, viaGroup: boolean): TreeSelectRow[] =>
    nodes.flatMap((node): TreeSelectRow[] => {
      const indent = depth * LEVEL_INDENT + BASE_INDENT
      if (node.kind === 'item') {
        if (node.depth !== undefined) return walkHierarchicalItem(node)
        return isVisibleItem(node)
          ? [
              {
                type: 'item',
                value: node.value,
                name: node.name,
                indent: indent + ITEM_MARK_INDENT,
                isSelected: selected.has(node.value),
                isViaGroup: viaGroup,
                section: 'tree',
                isFavorite: isFavorite(node.value),
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

  const favoriteRows = categories.flatMap((category) => collectFavorites(category.nodes, false))
  // お気に入りのセクションがあるときは、区分が1つだけでも、従来のツリーの先頭に区分の見出しを出して、お気に入りと区別できるようにする
  const showCategoryNames = categories.length > 1 || favoriteRows.length > 0

  const treeRows = categories.flatMap((category) => {
    const rows = walk(category.nodes, 0, false)
    if (rows.length === 0) return []
    return showCategoryNames ? [{ type: 'category' as const, name: category.name }, ...rows] : rows
  })
  if (favoriteRows.length === 0) return treeRows
  return [{ type: 'category' as const, name: FAVORITES_CATEGORY_NAME }, ...favoriteRows, ...treeRows]
}
