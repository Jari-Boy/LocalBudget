import type { AccountGroup } from './AccountGroup'

/**
 * 循環参照検証の純粋関数(docs/domain/accounts.md 3.3節「循環参照の防止はRepository層で
 * 行う」)。candidateParentIdを起点に親グループ方向(parentGroupId)を祖先へ辿り、
 * groupId自身が現れるかを判定する。現れる場合、candidateParentIdをgroupIdの新しい親に
 * 設定すると循環参照になる(candidateParentId自体がgroupIdと同一の自己参照ケースも含む)。
 * DB非依存。groupsは呼び出し側(インフラ層のRepository実装)が事前に全件取得して渡す。
 */
export function isDescendantGroup(
  groups: readonly AccountGroup[],
  groupId: number,
  candidateParentId: number,
): boolean {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  let currentId: number | null = candidateParentId
  while (currentId !== null) {
    if (currentId === groupId) return true
    currentId = groupById.get(currentId)?.parentGroupId ?? null
  }
  return false
}
