import type { JournalEntryFilter, JournalEntrySideFilter } from '../../../domain/journal/JournalEntryFilter'
import type { JournalEntry } from '../../../domain/journal/JournalEntry'
import { collectFinancialInstitutionNames } from '../../../domain/statement-import/financialInstitution'
import { SOURCE_TAGS } from '../journal-result/journalResultModel'
import { GROUP_VALUE_PREFIX } from '../tree-select/treeSelectModel'

/**
 * 仕訳の絞り込みUIと検索条件(JournalEntryFilter)を相互変換する純粋関数(計画Issue #150)。
 * 選択ツリーの値は、項目が「ID」、グループが「g:ID」、未選択が空文字。UIは各軸について
 * 複数選択に対応する(計画Issue #203)。各軸の選択は値の配列で扱い、項目とグループを併用できる
 * (軸の中はOR)。単一選択の関数(getTreeValue等)は、先頭の1件だけを扱う従来の呼び出し用に残す。
 * DB・DOM非依存。
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

/**
 * 条件を読み書きする範囲(計画Issue #314)。'both'は従来の「まとめて」(仕訳のどの明細行でもよい)、'debit'・'credit'は
 * 借方・貸方の明細行だけで判定する条件(JournalEntryFilter.debit / credit)。
 */
export type FilterScope = 'both' | 'debit' | 'credit'

/** 借方・貸方に分けられる軸(明細行ごとの属性)のキー。「まとめて」の条件として JournalEntryFilter に直に持つ */
const SIDE_AXIS_KEYS = [
  'accountIds',
  'accountGroupIds',
  'counterpartyIds',
  'counterpartyGroupIds',
  'projectIds',
  'projectGroupIds',
  'householdMemberIds',
  'settlementBatchIds',
] as const

function readScope(filter: JournalEntryFilter, scope: FilterScope): JournalEntrySideFilter {
  return scope === 'both' ? filter : (filter[scope] ?? {})
}

/**
 * 範囲の中の keys の条件を消し、values に書いた条件に置き換える。借方・貸方の側は、条件が1つも残らなければキーごと消す。
 */
function replaceScopeKeys(
  filter: JournalEntryFilter,
  scope: FilterScope,
  keys: readonly (keyof JournalEntrySideFilter)[],
  values: JournalEntrySideFilter,
): JournalEntryFilter {
  if (scope === 'both') return { ...without(filter, keys), ...values }
  const side: Record<string, unknown> = { ...(filter[scope] ?? {}) }
  for (const key of keys) delete side[key]
  Object.assign(side, values)
  const next = { ...filter }
  if (Object.keys(side).length === 0) delete next[scope]
  else next[scope] = side as JournalEntrySideFilter
  return next
}

/** 項目(ID)→グループ(g:ID)の順に、選択ツリーの値の配列として取り出す */
export function getTreeValues(filter: JournalEntryFilter, axis: TreeAxis, scope: FilterScope = 'both'): string[] {
  const { ids, groupIds } = AXIS_KEYS[axis]
  const axes = readScope(filter, scope)
  return [
    ...(axes[ids] ?? []).map(String),
    ...(axes[groupIds] ?? []).map((id) => `${GROUP_VALUE_PREFIX}${id}`),
  ]
}

/** 項目の値とグループの値(g:ID)の混在した配列を、「〜Ids」と「〜GroupIds」に振り分ける。空配列でその軸を消す */
export function setTreeValues(
  filter: JournalEntryFilter,
  axis: TreeAxis,
  values: readonly string[],
  scope: FilterScope = 'both',
): JournalEntryFilter {
  const { ids, groupIds } = AXIS_KEYS[axis]
  const groups = values.filter((value) => value.startsWith(GROUP_VALUE_PREFIX))
  const items = values.filter((value) => !value.startsWith(GROUP_VALUE_PREFIX))
  const next: Record<string, unknown> = {}
  if (items.length > 0) next[ids] = items.map(Number)
  if (groups.length > 0) next[groupIds] = groups.map((value) => Number(value.slice(GROUP_VALUE_PREFIX.length)))
  return replaceScopeKeys(filter, scope, [ids, groupIds], next as JournalEntrySideFilter)
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

export function getBatchValues(filter: JournalEntryFilter, scope: FilterScope = 'both'): string[] {
  return (readScope(filter, scope).settlementBatchIds ?? []).map((id) => (id === null ? NO_BATCH_VALUE : String(id)))
}

/** 「未割当」(none)はnull、バッチはIDにして保持する。空配列で指定を消す */
export function setBatchValues(
  filter: JournalEntryFilter,
  values: readonly string[],
  scope: FilterScope = 'both',
): JournalEntryFilter {
  return replaceScopeKeys(
    filter,
    scope,
    ['settlementBatchIds'],
    values.length === 0 ? {} : { settlementBatchIds: values.map((value) => (value === NO_BATCH_VALUE ? null : Number(value))) },
  )
}

/** 世帯メンバーの選択欄の値(数値IDの文字列)の取り出し。範囲は借方・貸方・まとめて(計画Issue #314) */
export function getMemberValues(filter: JournalEntryFilter, scope: FilterScope = 'both'): string[] {
  return (readScope(filter, scope).householdMemberIds ?? []).map(String)
}

/** 世帯メンバーの選択欄の値を書く。空配列で指定を消す */
export function setMemberValues(
  filter: JournalEntryFilter,
  values: readonly string[],
  scope: FilterScope = 'both',
): JournalEntryFilter {
  return replaceScopeKeys(filter, scope, ['householdMemberIds'], values.length === 0 ? {} : { householdMemberIds: values.map(Number) })
}

/** 借方・貸方に分けるとき(計画Issue #314)。競合する「まとめて」の軸(科目・取引先・プロジェクト・世帯メンバー・精算バッチ)を消す。摘要・期間・金額・出どころは残す */
export function toSplitMode(filter: JournalEntryFilter): JournalEntryFilter {
  return without(filter, SIDE_AXIS_KEYS)
}

/** まとめてに戻すとき(計画Issue #314)。借方・貸方の条件を消す */
export function toCombinedMode(filter: JournalEntryFilter): JournalEntryFilter {
  return without(filter, ['debit', 'credit'])
}

/** 借方・貸方の条件が1つでも指定されているか */
export function hasSideConditions(filter: JournalEntryFilter): boolean {
  return [filter.debit, filter.credit].some((side) => side !== undefined && countSideAxes(side) > 0)
}

export function getMultiValues(filter: JournalEntryFilter, key: 'householdMemberIds' | 'sourceTypes'): string[] {
  return (filter[key] ?? []).map(String)
}

/** 世帯メンバーは数値ID、出どころは文字列で保持する。空配列で指定を消す */
export function setMultiValues(
  filter: JournalEntryFilter,
  key: 'householdMemberIds' | 'sourceTypes',
  values: readonly string[],
): JournalEntryFilter {
  if (values.length === 0) return without(filter, [key])
  if (key === 'householdMemberIds') return { ...filter, householdMemberIds: values.map(Number) }
  return { ...filter, sourceTypes: values as NonNullable<JournalEntryFilter['sourceTypes']> }
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

/** 「出どころ」の選択ツリーで、金融機関を表す値の接頭辞(「inst:名前」。名前が空の「inst:」は、金融機関が不明な取込済み) */
const INSTITUTION_VALUE_PREFIX = 'inst:'

/** 出どころの選択肢1件(階層つきの項目はdepth・parentValueを持つ) */
export interface SourceFilterChoice {
  value: string
  name: string
  depth?: number
  parentValue?: string | null
  /** 科目などのグループ行と同じ見た目(名前で開閉・「すべて」で選択)にする親の項目 */
  asGroup?: boolean
}

/**
 * 出どころの選択欄の値(作成経路と金融機関)の取り出し(計画Issue #289)。作成経路はそのまま、金融機関は「inst:名前」、
 * 金融機関が不明な取込済みは「inst:」の値にする。
 */
export function getSourceValues(filter: JournalEntryFilter): string[] {
  return [
    ...(filter.sourceTypes ?? []).map(String),
    ...(filter.financialInstitutionNames ?? []).map((name) => `${INSTITUTION_VALUE_PREFIX}${name ?? ''}`),
  ]
}

/** 出どころの選択欄の値の配列を、作成経路(sourceTypes)と金融機関(financialInstitutionNames)に振り分ける。空配列で両方を消す */
export function setSourceValues(filter: JournalEntryFilter, values: readonly string[]): JournalEntryFilter {
  const next = without(filter, ['sourceTypes', 'financialInstitutionNames'])
  const institutions = values.filter((value) => value.startsWith(INSTITUTION_VALUE_PREFIX))
  const sourceTypes = values.filter((value) => !value.startsWith(INSTITUTION_VALUE_PREFIX))
  if (sourceTypes.length > 0) next.sourceTypes = sourceTypes as NonNullable<JournalEntryFilter['sourceTypes']>
  if (institutions.length > 0) {
    next.financialInstitutionNames = institutions.map((value) => value.slice(INSTITUTION_VALUE_PREFIX.length) || null)
  }
  return next
}

/**
 * 出どころの選択肢を作る(計画Issue #289)。作成経路をSOURCE_TAGSの順に並べ、取込済みの仕訳に金融機関名があれば、
 * 「外部明細」(グループ行の見た目で、「すべて」で取込済みすべてを選ぶ)を親、各金融機関(マッピング定義の候補と同じ順)を子にして階層で並べる。金融機関が不明な取込済みの仕訳も
 * あるときは、最後の子に「外部明細(金融機関が不明)」を足す。取込済みの仕訳に金融機関が無ければ、従来どおり平らな並び。
 */
export function buildSourceFilterChoices(
  entries: readonly Pick<JournalEntry, 'sourceType' | 'financialInstitutionName'>[],
): SourceFilterChoice[] {
  const imported = entries.filter((entry) => entry.sourceType === 'external_import')
  // 金融機関名の並べ方は、マッピング定義の選択候補(collectFinancialInstitutionNames)と同じにそろえる
  const names = collectFinancialInstitutionNames(imported.flatMap((entry) => (entry.financialInstitutionName ? [entry.financialInstitutionName] : [])))
  const hasUnknown = imported.some((entry) => !entry.financialInstitutionName)

  return Object.entries(SOURCE_TAGS).flatMap(([value, tag]): SourceFilterChoice[] => {
    if (value !== 'external_import' || names.length === 0) return [{ value, name: tag.label }]
    const children: SourceFilterChoice[] = names.map((name) => ({
      value: `${INSTITUTION_VALUE_PREFIX}${name}`,
      name,
      depth: 1,
      parentValue: value,
    }))
    if (hasUnknown) {
      children.push({ value: INSTITUTION_VALUE_PREFIX, name: `${tag.label}(金融機関が不明)`, depth: 1, parentValue: value })
    }
    return [{ value, name: tag.label, depth: 0, parentValue: null, asGroup: true }, ...children]
  })
}

/**
 * 絞り込む対象の仕訳から、期間を月で選ぶときの月の選択肢の元(取引日。重複なし・古い順)と、金額スライダーの
 * 上限の元になる最大金額(仕訳の金額=借方合計の最大)を求める(計画Issue #314)。仕訳が無ければ空・0。
 */
export function buildEntryRangeOptions(
  entries: readonly { entryDate: string; lines: readonly { side: string; amount: number }[] }[],
): { entryDates: string[]; maxAmount: number } {
  const dates = new Set<string>()
  let maxAmount = 0
  for (const entry of entries) {
    dates.add(entry.entryDate)
    const debitTotal = entry.lines.filter((line) => line.side === 'debit').reduce((total, line) => total + line.amount, 0)
    if (debitTotal > maxAmount) maxAmount = debitTotal
  }
  return { entryDates: [...dates].sort(), maxAmount }
}

const hasItems = (list: readonly unknown[] | undefined) => (list?.length ?? 0) > 0

/** 借方・貸方の1つの側で、条件のある軸の数(科目・取引先・プロジェクト・世帯メンバー・精算バッチ) */
function countSideAxes(side: JournalEntrySideFilter): number {
  return [
    hasItems(side.accountIds) || hasItems(side.accountGroupIds),
    hasItems(side.counterpartyIds) || hasItems(side.counterpartyGroupIds),
    hasItems(side.projectIds) || hasItems(side.projectGroupIds),
    hasItems(side.householdMemberIds),
    hasItems(side.settlementBatchIds),
  ].filter(Boolean).length
}

/** 有効な条件の数。期間・金額は範囲として、各軸(科目・科目グループ等)は1件として数える。借方・貸方の条件は、側ごと・軸ごとに1件 */
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
    hasItems(filter.sourceTypes) || hasItems(filter.financialInstitutionNames),
  ]
  const sides = [filter.debit, filter.credit].reduce((total, side) => total + (side === undefined ? 0 : countSideAxes(side)), 0)
  return conditions.filter(Boolean).length + sides
}
