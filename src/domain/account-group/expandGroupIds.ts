import type { GroupNode } from './isDescendantGroup'

/**
 * 指定したグループと、その配下(入れ子を含む)のグループのid集合を返す(計画Issue #145、
 * 仕訳の検索条件の「グループ指定(配下すべてを対象)」で使う)。勘定科目・取引先・プロジェクトの
 * 3種類のグループで共用する。groupsは呼び出し側が事前に全件取得して渡す(DB非依存の純粋関数)。
 * 一覧に存在しないidは、そのid自身だけを含める。
 */
export function expandGroupIds(groups: readonly GroupNode[], groupIds: readonly number[]): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const group of groups) {
    if (group.parentGroupId === null) continue
    childrenByParent.set(group.parentGroupId, [...(childrenByParent.get(group.parentGroupId) ?? []), group.id])
  }

  const result = new Set<number>()
  const pending = [...groupIds]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (result.has(id)) continue
    result.add(id)
    pending.push(...(childrenByParent.get(id) ?? []))
  }
  return result
}
