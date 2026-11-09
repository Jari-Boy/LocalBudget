import { expandGroupIds } from '../../domain/account-group/expandGroupIds'
import type { GroupNode } from '../../domain/account-group/isDescendantGroup'
import type { FinancialStatementFilter } from '../../domain/financial-statement/FinancialStatementFilter'
import type { Period } from '../../domain/financial-statement/Period'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { setTreeValue } from '../common/journal-filter/journalFilterModel'
import { GROUP_VALUE_PREFIX } from '../common/tree-select/treeSelectModel'

/**
 * 分析画面の条件(計画Issue #155)を、集計用の絞り込みと仕訳一覧へ引き継ぐ絞り込みへ変換する
 * 純粋関数。条件バーの選択ツリーの値は、項目が「ID」、グループが「g:ID」、未選択が空文字。
 * DOM・DB非依存。
 */
export interface AnalysisConditionValues {
  member: string
  project: string
  counterparty: string
}

export interface AnalysisConditionMasters {
  projects: readonly { id: number; projectGroupId: number | null }[]
  projectGroups: readonly GroupNode[]
  counterparties: readonly { id: number; counterpartyGroupId: number | null }[]
  counterpartyGroups: readonly GroupNode[]
}

/** 選択ツリーの値を、項目のID(グループなら配下の項目のID)に展開する。未選択はnull。 */
function resolveIds<T extends { id: number }>(
  value: string,
  items: readonly T[],
  groupIdOf: (item: T) => number | null,
  groups: readonly GroupNode[],
): number[] | null {
  if (value === '') return null
  if (!value.startsWith(GROUP_VALUE_PREFIX)) return [Number(value)]
  const groupIds = expandGroupIds(groups, [Number(value.slice(GROUP_VALUE_PREFIX.length))])
  return items.filter((item) => {
    const groupId = groupIdOf(item)
    return groupId !== null && groupIds.has(groupId)
  }).map((item) => item.id)
}

/**
 * 財務諸表の絞り込みにする。グループは配下(入れ子を含む)の項目のIDに展開する。
 * 配下に項目がないグループは、全件にならないよう空配列(どの明細にも一致しない)にする。
 */
export function toStatementFilter(
  values: AnalysisConditionValues,
  masters: AnalysisConditionMasters,
): FinancialStatementFilter {
  const filter: FinancialStatementFilter = {}
  if (values.member !== '') filter.householdMemberIds = [Number(values.member)]
  const projectIds = resolveIds(values.project, masters.projects, (p) => p.projectGroupId, masters.projectGroups)
  if (projectIds) filter.projectIds = projectIds
  const counterpartyIds = resolveIds(
    values.counterparty,
    masters.counterparties,
    (c) => c.counterpartyGroupId,
    masters.counterpartyGroups,
  )
  if (counterpartyIds) filter.counterpartyIds = counterpartyIds
  return filter
}

/** 期間(nullなら日付の条件なし)と選んだ条件を、仕訳一覧の検索条件にする。グループはグループ指定のまま渡す。 */
export function toJournalFilter(
  period: Period | null,
  values: AnalysisConditionValues,
  extra: { accountIds?: readonly number[] } = {},
): JournalEntryFilter {
  let filter: JournalEntryFilter = period ? { dateFrom: period.from, dateTo: period.to } : {}
  if (values.member !== '') filter = { ...filter, householdMemberIds: [Number(values.member)] }
  filter = setTreeValue(filter, 'project', values.project)
  filter = setTreeValue(filter, 'counterparty', values.counterparty)
  if (extra.accountIds) filter = { ...filter, accountIds: extra.accountIds }
  return filter
}
