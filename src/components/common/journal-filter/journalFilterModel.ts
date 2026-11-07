import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import { GROUP_VALUE_PREFIX } from '../tree-select/treeSelectModel'

/**
 * 仕訳の絞り込みUIと検索条件(JournalEntryFilter)を相互変換する純粋関数(計画Issue #150)。
 * 選択ツリーの値は、項目が「ID」、グループが「g:ID」、未選択が空文字。UIは各軸について
 * 1件だけ選ぶ(ドメインは複数指定を許すが、UIでは単一指定のみ扱う)。DB・DOM非依存。
 */
export type TreeAxis = 'account' | 'counterparty' | 'project'

const AXIS_KEYS = {
  account: { ids: 'accountIds', groupIds: 'accountGroupIds' },
  counterparty: { ids: 'counterpartyIds', groupIds: 'counterpartyGroupIds' },
  project: { ids: 'projectIds', groupIds: 'projectGroupIds' },
} as const

/** 精算バッチの「未割当」を表す選択ツリーの値(フィルタ上はnull) */
export const NO_BATCH_VALUE = 'none'

function without(filter: JournalEntryFilter, keys: readonly (keyof JournalEntryFilter)[]): JournalEntryFilter {
  const next = { ...filter }
  for (const key of keys) delete next[key]
  return next
}

export function getTreeValue(filter: JournalEntryFilter, axis: TreeAxis): string {
  const { ids, groupIds } = AXIS_KEYS[axis]
  const groupId = filter[groupIds]?.[0]
  if (groupId !== undefined) return `${GROUP_VALUE_PREFIX}${groupId}`
  const id = filter[ids]?.[0]
  return id === undefined ? '' : String(id)
}

export function setTreeValue(filter: JournalEntryFilter, axis: TreeAxis, value: string): JournalEntryFilter {
  const { ids, groupIds } = AXIS_KEYS[axis]
  const cleared = without(filter, [ids, groupIds])
  if (value === '') return cleared
  if (value.startsWith(GROUP_VALUE_PREFIX)) {
    return { ...cleared, [groupIds]: [Number(value.slice(GROUP_VALUE_PREFIX.length))] }
  }
  return { ...cleared, [ids]: [Number(value)] }
}

export function setMemo(filter: JournalEntryFilter, text: string): JournalEntryFilter {
  return text.trim() === '' ? without(filter, ['memo']) : { ...filter, memo: text }
}

export function setDate(
  filter: JournalEntryFilter,
  key: 'dateFrom' | 'dateTo',
  value: string,
): JournalEntryFilter {
  return value === '' ? without(filter, [key]) : { ...filter, [key]: value }
}

/** 空欄は条件を消す。数値として読めない入力は無視する(現在の条件を変えない)。 */
export function setAmount(
  filter: JournalEntryFilter,
  key: 'amountMin' | 'amountMax',
  text: string,
): JournalEntryFilter {
  if (text.trim() === '') return without(filter, [key])
  const amount = Number(text)
  return Number.isFinite(amount) ? { ...filter, [key]: amount } : filter
}

export function getBatchValue(filter: JournalEntryFilter): string {
  const batch = filter.settlementBatchIds?.[0]
  if (batch === undefined) return ''
  return batch === null ? NO_BATCH_VALUE : String(batch)
}

export function setBatchValue(filter: JournalEntryFilter, value: string): JournalEntryFilter {
  if (value === '') return without(filter, ['settlementBatchIds'])
  return { ...filter, settlementBatchIds: [value === NO_BATCH_VALUE ? null : Number(value)] }
}

export function getSingleValue(
  filter: JournalEntryFilter,
  key: 'householdMemberIds' | 'sourceTypes',
): string {
  const value = filter[key]?.[0]
  return value === undefined ? '' : String(value)
}

export function setSingleValue(
  filter: JournalEntryFilter,
  key: 'householdMemberIds' | 'sourceTypes',
  value: string,
): JournalEntryFilter {
  if (value === '') return without(filter, [key])
  if (key === 'householdMemberIds') return { ...filter, householdMemberIds: [Number(value)] }
  return { ...filter, sourceTypes: [value as NonNullable<JournalEntryFilter['sourceTypes']>[number]] }
}

const hasItems = (list: readonly unknown[] | undefined) => (list?.length ?? 0) > 0

/** 有効な条件の数。期間・金額は範囲として、各軸(科目・科目グループ等)は1件として数える。 */
export function countActiveConditions(filter: JournalEntryFilter): number {
  const conditions = [
    (filter.memo ?? '').trim() !== '',
    filter.dateFrom !== undefined || filter.dateTo !== undefined,
    filter.amountMin !== undefined || filter.amountMax !== undefined,
    hasItems(filter.accountIds) || hasItems(filter.accountGroupIds),
    hasItems(filter.counterpartyIds) || hasItems(filter.counterpartyGroupIds),
    hasItems(filter.projectIds) || hasItems(filter.projectGroupIds),
    hasItems(filter.householdMemberIds),
    hasItems(filter.settlementBatchIds),
    hasItems(filter.sourceTypes),
  ]
  return conditions.filter(Boolean).length
}
