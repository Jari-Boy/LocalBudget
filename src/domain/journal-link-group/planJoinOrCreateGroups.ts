export type JoinOrCreateGroupsPlan =
  | { type: 'create'; journalEntryIds: number[] }
  | { type: 'join'; groupIds: number[]; newEntryIds: number[] }

/**
 * 関連仕訳グループへの参加/新規作成の判定(計画Issue #138)。anchorEntryIds(既存の仕訳群、
 * 割勘の元仕訳・精算対象の割勘仕訳・手動関連付けの起点仕訳など)が既にどのグループに
 * 所属しているか(existingGroupIdsByEntryId)を見て、
 * - いずれのグループにも所属していなければ、anchorEntryIds・newEntryIdsをまとめた
 *   新規グループ作成を計画する('create')
 * - 1つ以上のグループに所属していれば、それらすべてのグループへnewEntryIdsを参加させる
 *   計画を返す('join')。anchorEntryIds自身はどのグループにも追加しない(既存のグループ
 *   構成を変更しない)。これにより、newEntryId(例: 精算仕訳)が複数の無関係な既存グループ
 *   (例: 異なる精算バッチの割勘仕訳同士)を橋渡しする一方、それらの既存グループ同士が
 *   意図せず統合されることを防ぐ(計画Issue #138の懸念点「1つの口座引き落とし仕訳が、
 *   無関係な2つの異なる精算バッチの両方を同時に消し込むケース」への対応)。
 *
 * DBアクセスなしの純粋関数。existingGroupIdsByEntryIdの実際の取得(DBクエリ)は
 * JournalEntryLinkGroupRepository側の責務。
 */
export function planJoinOrCreateGroups(
  anchorEntryIds: readonly number[],
  newEntryIds: readonly number[],
  existingGroupIdsByEntryId: ReadonlyMap<number, readonly number[]>,
): JoinOrCreateGroupsPlan {
  const existingGroupIds = [
    ...new Set(anchorEntryIds.flatMap((id) => existingGroupIdsByEntryId.get(id) ?? [])),
  ]

  if (existingGroupIds.length === 0) {
    return { type: 'create', journalEntryIds: [...new Set([...anchorEntryIds, ...newEntryIds])] }
  }

  return { type: 'join', groupIds: existingGroupIds, newEntryIds: [...new Set(newEntryIds)] }
}
