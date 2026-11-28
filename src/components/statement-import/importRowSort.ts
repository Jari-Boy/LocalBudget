/**
 * 明細取込画面の一覧のヘッダーでの並び替え(計画Issue #231 フェーズ2)の、明細取込向けの値の取り方。
 * 並び替えの仕組み(昇順→降順→解除、押した時点の値で固定、未設定は最後)は、3画面共通の
 * common/table-sort/tableSort に一般化した(計画Issue #302)。ここは、列ごとの並び替えの値と、外部取引IDをidにする部分だけを持つ。
 * 並び替えは「新規」「重複」のタブの中だけで行う。DB・DOM非依存。
 */
import { compareByTableSort, cycleTableSort, textSortValue, type SortValue, type TableSort } from '../common/table-sort/tableSort'
import type { RowStatus } from './importRowModel'

/** 並び替えできる列。チェック・プロジェクト・メンバー・コメント(入力欄の列)は対象にしない */
export type SortKey = 'file' | 'date' | 'description' | 'amount' | 'counterAccount' | 'counterparty' | 'status'

/** 並び替えの状態。valuesは押した時点の並び替えの値(外部取引IDごと)。以後の入力では更新しない */
export type ImportSort = TableSort<SortKey>

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

function sortValueOf(key: SortKey, row: SortableRow): SortValue {
  switch (key) {
    case 'file':
      return textSortValue(row.fileName)
    case 'date':
      return textSortValue(row.entryDate)
    case 'description':
      return textSortValue(row.description)
    case 'amount':
      return row.amount
    case 'counterAccount':
      return textSortValue(row.counterAccountName)
    case 'counterparty':
      return textSortValue(row.counterpartyName)
    case 'status':
      return STATUS_ORDER[row.status]
  }
}

/**
 * ヘッダーを押したときの次の状態。同じ列を押すたびに 昇順 → 降順 → 解除(null)、別の列を押すとその列の昇順。
 * rowsは押した時点の表示対象の行で、並び替えの値をここで確定する。
 */
export function cycleSort(current: ImportSort | null, key: SortKey, rows: readonly SortableRow[]): ImportSort | null {
  return cycleTableSort(current, key, rows, sortValueOf, (row) => row.externalId)
}

/** 2行の比較(タブの中での並び替え用)。並び替えが無い・値が同じなら0を返すので、呼び出し側が元の順で決める */
export function compareBySort(sort: ImportSort | null, a: { externalId: string }, b: { externalId: string }): number {
  return compareByTableSort(sort, a.externalId, b.externalId)
}
