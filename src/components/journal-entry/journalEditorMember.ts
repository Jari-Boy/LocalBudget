import type { JournalEntryFormLine } from './journalEntryFormLine'

/**
 * 仕訳の詳細パネルで、明細行の世帯メンバーを決める純粋関数(計画Issue #169)。
 * 明細行は常に実際の世帯メンバーを持つ。入力時の既定値は起票者で、科目に既定メンバーがある行は
 * その既定値で固定する(docs/domain/household-members.md 1.2節)。
 */

/**
 * 科目を変えたときの、行の世帯メンバー。
 * - 既定メンバーのある科目: その既定値(固定)
 * - 既定メンバーのない科目: 手で選んだ値は保つ。ただし、固定されていた(元の科目に既定メンバーがあった)行と、
 *   未設定の行は、起票者にする
 */
export function memberAfterAccountChange(params: {
  line: JournalEntryFormLine
  newAccountDefault: number | null
  previousAccountDefault: number | null
  entryMemberId: number | null
}): number | null {
  const { line, newAccountDefault, previousAccountDefault, entryMemberId } = params
  if (newAccountDefault !== null) return newAccountDefault
  if (previousAccountDefault !== null || line.householdMemberId === null) return entryMemberId
  return line.householdMemberId
}

/**
 * 起票者を変えたとき、手で変えていない行だけを新しい起票者に追従させる。追従するのは、旧起票者のままか
 * 未設定で、科目に既定メンバーがない行。科目の既定で固定された行と、手で別のメンバーにした行は動かない。
 * 新しい起票者が未選択、または変わらないときは、渡された配列をそのまま返す。
 */
export function followBookkeeper<T extends { line: JournalEntryFormLine }>(
  lines: readonly T[],
  defaultMemberOf: (accountId: number | null) => number | null,
  previousEntryMemberId: number | null,
  nextEntryMemberId: number | null,
): readonly T[] {
  if (nextEntryMemberId === null || nextEntryMemberId === previousEntryMemberId) return lines
  return lines.map((item) => {
    const follows =
      defaultMemberOf(item.line.accountId) === null &&
      (item.line.householdMemberId === null || item.line.householdMemberId === previousEntryMemberId)
    return follows ? { ...item, line: { ...item.line, householdMemberId: nextEntryMemberId } } : item
  })
}
