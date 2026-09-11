import type { AccountGroup } from './AccountGroup'

/**
 * 勘定科目グループの入れ子構造(docs/domain/accounts.md 3.3節)から、各グループについて
 * 「親 > 子」形式のパス表示ラベルを組み立てる純粋関数。グループ名は同じ親グループ内でのみ
 * ユニークであり、親が異なれば同名グループが存在しうる(意図的な仕様、3.3節参照)。
 * フラットな<select>の選択肢は深さによるインデント表現ができないため、名前だけを
 * 表示すると異なる親配下の同名グループが区別できなくなる。この関数が返すパス表示ラベルを
 * 選択肢の表示に使うことで、同名グループでも区別できるようにする。DB非依存。
 */
export function buildAccountGroupPathLabels(groups: readonly AccountGroup[]): Map<number, string> {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const labelById = new Map<number, string>()

  const resolve = (id: number): string => {
    const cached = labelById.get(id)
    if (cached !== undefined) return cached

    const group = groupById.get(id)!
    const label = group.parentGroupId === null ? group.name : `${resolve(group.parentGroupId)} > ${group.name}`
    labelById.set(id, label)
    return label
  }

  for (const group of groups) {
    resolve(group.id)
  }
  return labelById
}
