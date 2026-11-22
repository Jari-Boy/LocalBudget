/**
 * 明細取込画面の一覧の、列ごとの行の絞り込み(計画Issue #258)の純粋関数。
 * 摘要はテキスト(選択欄の検索と同じ正規化)、期間は開始日・終了日(両端を含む)、相手科目・取引先・プロジェクト・メンバーはidか「未設定」で絞り、複数の条件はすべてに合う行だけを残す(AND)。
 * 絞り込みは表示だけの条件で、行の状態・並び・グループ判定には触れない。DB・DOM非依存。
 */
import { matchesSearch } from '../common/tree-select/normalizeForSearch'

/** idの条件。null=絞らない、'unset'=その項目が未設定(null)の行、数値=そのidの行 */
export type IdCondition = null | 'unset' | number

export interface ImportRowFilter {
  /** 摘要に含まれる文字。空(空白のみ含む)なら絞らない */
  description: string
  /** 期間の開始日(YYYY-MM-DD)。空なら下限なし */
  dateFrom: string
  /** 期間の終了日(YYYY-MM-DD)。空なら上限なし */
  dateTo: string
  counterAccount: IdCondition
  counterparty: IdCondition
  project: IdCondition
  /** メンバー。相手科目に既定のメンバーがある行は、その既定のメンバーで判定する */
  member: IdCondition
}

/** 条件が1つも無い状態 */
export const EMPTY_ROW_FILTER: ImportRowFilter = {
  description: '',
  dateFrom: '',
  dateTo: '',
  counterAccount: null,
  counterparty: null,
  project: null,
  member: null,
}

/** 絞り込みの判定に使う、行の見え方 */
export interface FilterableRow {
  /** 画面に出している摘要 */
  description: string
  /** 日付(YYYY-MM-DD) */
  entryDate: string
  /** 入力欄の値。重複の行のように入力欄を持たない行はnull */
  inputs: {
    counterAccountId: number | null
    counterpartyId: number | null
    projectId: number | null
    /** 画面に出しているメンバー(科目の既定のメンバー、無ければ行で選んだメンバー) */
    memberId: number | null
  } | null
}

/** 指定されている条件の数(空白だけの摘要は数えない。期間は開始日・終了日のどちらを指定しても1つ) */
export function activeConditionCount(filter: ImportRowFilter): number {
  return (
    (filter.description.trim() !== '' ? 1 : 0) +
    (filter.dateFrom !== '' || filter.dateTo !== '' ? 1 : 0) +
    [filter.counterAccount, filter.counterparty, filter.project, filter.member].filter((c) => c !== null).length
  )
}

export function isRowFilterActive(filter: ImportRowFilter): boolean {
  return activeConditionCount(filter) > 0
}

function matchesId(condition: IdCondition, value: number | null): boolean {
  if (condition === null) return true
  return condition === 'unset' ? value === null : value === condition
}

/**
 * 行がすべての条件に合うか。入力欄を持たない行(重複)は、科目・取引先・プロジェクト・メンバーの値を持たないので、
 * それらの条件があるときは(「未設定」でも)合わない。摘要・期間は、どの行も日付と摘要を持つので判定する。
 */
export function matchesRowFilter(filter: ImportRowFilter, row: FilterableRow): boolean {
  if (!matchesSearch(row.description, filter.description)) return false
  // ISO形式(YYYY-MM-DD)なので、文字列のまま日付の順に比べられる
  if (filter.dateFrom !== '' && row.entryDate < filter.dateFrom) return false
  if (filter.dateTo !== '' && row.entryDate > filter.dateTo) return false
  const idConditions = [filter.counterAccount, filter.counterparty, filter.project, filter.member]
  if (row.inputs === null) return idConditions.every((c) => c === null)
  return (
    matchesId(filter.counterAccount, row.inputs.counterAccountId) &&
    matchesId(filter.counterparty, row.inputs.counterpartyId) &&
    matchesId(filter.project, row.inputs.projectId) &&
    matchesId(filter.member, row.inputs.memberId)
  )
}

/** 絞り込みで見えなくなった行の選択を外す。残した選択と、外した件数を返す */
export function pruneSelection(
  selected: ReadonlySet<number>,
  isVisible: (index: number) => boolean,
): { kept: Set<number>; removed: number } {
  const kept = new Set([...selected].filter(isVisible))
  return { kept, removed: selected.size - kept.size }
}
