/**
 * 明細取込画面の一覧のヘッダーでの並び替え(計画Issue #231 フェーズ2)の純粋関数。
 * 並び替えは3グループ(重複・似た取引あり・問題なし)の中だけで行い、見出しは残す。ヘッダーを押した時点の値で並びを決め、
 * そのあと行の入力を変えても並びは動かない(入力した行を見失わない)。そのため、押した時点の並び替えの値を
 * 外部取引ID(ファイルのチェックの切り替えで一覧を作り直しても変わらない)ごとに持つ。DB・DOM非依存。
 */
import type { RowStatus } from './importRowModel'

/** 並び替えできる列。チェック・プロジェクト・メンバー・コメント(入力欄の列)は対象にしない */
export type SortKey = 'file' | 'date' | 'description' | 'amount' | 'counterAccount' | 'counterparty' | 'status'

export type SortDirection = 'asc' | 'desc'

type SortValue = string | number | null

/** 並び替えの状態。valuesは押した時点の並び替えの値(外部取引IDごと)。以後の入力では更新しない */
export interface ImportSort {
  key: SortKey
  direction: SortDirection
  values: ReadonlyMap<string, SortValue>
}

/** 並び替えの値を取り出すための、行の見え方 */
export interface SortableRow {
  externalId: string
  fileName: string
  entryDate: string
  description: string
  amount: number
  counterAccountName: string
  counterpartyName: string
  status: RowStatus
}

/** 状態の並び。要確認(これから入力する行)を先頭に出す */
const STATUS_ORDER: Record<RowStatus, number> = { check: 0, new: 1, skipped: 2, duplicate: 3 }

/** 未設定(空)の値はnullにして、昇順でも降順でも最後に置く */
const text = (value: string): SortValue => (value === '' ? null : value)

function sortValueOf(key: SortKey, row: SortableRow): SortValue {
  switch (key) {
    case 'file':
      return text(row.fileName)
    case 'date':
      return text(row.entryDate)
    case 'description':
      return text(row.description)
    case 'amount':
      return row.amount
    case 'counterAccount':
      return text(row.counterAccountName)
    case 'counterparty':
      return text(row.counterpartyName)
    case 'status':
      return STATUS_ORDER[row.status]
  }
}

/**
 * ヘッダーを押したときの次の状態。同じ列を押すたびに 昇順 → 降順 → 解除(null)、別の列を押すとその列の昇順。
 * rowsは押した時点の表示対象の行で、並び替えの値をここで確定する。
 */
export function cycleSort(current: ImportSort | null, key: SortKey, rows: readonly SortableRow[]): ImportSort | null {
  const direction: SortDirection | null =
    current === null || current.key !== key ? 'asc' : current.direction === 'asc' ? 'desc' : null
  if (direction === null) return null
  return createSort(key, direction, rows)
}

/** 押した時点の値で並び替えの状態を作る */
export function createSort(key: SortKey, direction: SortDirection, rows: readonly SortableRow[]): ImportSort {
  return { key, direction, values: new Map(rows.map((r) => [r.externalId, sortValueOf(key, r)])) }
}

/**
 * 2行の比較(グループの中での並び替え用)。並び替えが無い・値が同じなら0を返すので、呼び出し側が元の順で決める。
 * 押した時点に無かった行(あとから現れた行)と未設定の値は、昇順でも降順でも最後に置く。
 * 文字は文字コードの順に比べる(環境による照合順の違いを避ける)。
 */
export function compareBySort(sort: ImportSort | null, a: { externalId: string }, b: { externalId: string }): number {
  if (sort === null) return 0
  const x = sort.values.get(a.externalId) ?? null
  const y = sort.values.get(b.externalId) ?? null
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  const result = typeof x === 'number' && typeof y === 'number' ? x - y : x < y ? -1 : x > y ? 1 : 0
  return sort.direction === 'asc' ? result : -result
}
