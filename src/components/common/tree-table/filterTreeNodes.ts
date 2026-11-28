import { normalizeForSearch } from '../../../domain/search/normalizeForSearch'
import type { TreeTableNode } from './treeTableModel'

/** 検索用の正規化: 選択欄と同じ(全角半角・大文字小文字・空白・ひらがなとカタカナの違いを無視する、計画Issue #233) */
export const normalizeSearch = normalizeForSearch

/**
 * ツリー表の検索による絞り込み(計画Issue #219)。項目(葉)は名称か表示列(cells)に検索語を含むものだけ残し、
 * グループは、配下(入れ子を含む)に残る項目があるとき、またはグループ自身の名称が一致したとき(配下の項目を
 * すべて残す)に残す。ノードの並びは元のまま。検索語が空なら元の配列をそのまま返す。
 * 表示用の絞り込みだけで、移動(ドラッグ)の判定には使わない(絞り込み中はドラッグを無効にする)。
 */
export function filterTreeNodes(nodes: TreeTableNode[], query: string): TreeTableNode[] {
  const keyword = normalizeSearch(query)
  if (keyword === '') return nodes

  const matches = (text: string) => normalizeSearch(text).includes(keyword)
  const byParent = new Map<string | null, TreeTableNode[]>()
  for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n])

  const keep = new Set<string>()
  /** nodeとその配下を調べ、残すものをkeepへ入れる。残すならtrue。forceは祖先のグループ名が一致して配下をすべて残す場合 */
  const visit = (n: TreeTableNode, force: boolean): boolean => {
    if (n.kind === 'leaf') {
      const hit = force || matches(n.name) || n.cells.some(matches)
      if (hit) keep.add(n.id)
      return hit
    }
    const selfHit = force || matches(n.name)
    let childHit = false
    for (const child of byParent.get(n.id) ?? []) childHit = visit(child, selfHit) || childHit
    if (selfHit || childHit) keep.add(n.id)
    return selfHit || childHit
  }
  for (const root of byParent.get(null) ?? []) visit(root, false)

  return nodes.filter((n) => keep.has(n.id))
}

/** 検索語(空なら常に一致)に、いずれかの文字列が含まれるか。ツリー表を使わないマスタの一覧(世帯メンバー・明細マッピング)用 */
export function matchesSearch(query: string, ...texts: string[]): boolean {
  const keyword = normalizeSearch(query)
  return keyword === '' || texts.some((text) => normalizeSearch(text).includes(keyword))
}
