/**
 * 表の列見出しでの並び替えの共通モデル(計画Issue #302)。明細取込(計画Issue #231 フェーズ2)の並び替えを、画面に
 * 依存しない形に一般化した。明細取込・仕訳一覧・割勘の3画面が同じ操作(見出しを押すごとに 昇順→降順→解除)で使う。
 * 見出しを押した時点の値で並びを決め、そのあと行の入力を変えても並びは動かない(編集した行を見失わない)。
 * そのため、押した時点の並び替えの値を、行のidごとに持つ。行のid・並べる列・列ごとの値の取り方は、画面が与える。DB・DOM非依存。
 */

export type SortDirection = 'asc' | 'desc'

/** 並び替えの値。文字は文字コード順、数は大小で比べる。null(未設定)は昇順でも降順でも最後に置く */
export type SortValue = string | number | null

/** 行を見分けるid。作り直しても変わらないもの(外部取引ID・仕訳のidなど) */
export type SortRowId = string | number

/** 並び替えの状態。valuesは押した時点の並び替えの値(行のidごと)。以後の入力では更新しない */
export interface TableSort<K extends string> {
  key: K
  direction: SortDirection
  values: ReadonlyMap<SortRowId, SortValue>
}

/** 未設定(空)の文字は null にして、昇順でも降順でも最後に置く */
export function textSortValue(value: string): SortValue {
  return value === '' ? null : value
}

/**
 * 見出しを押したときの次の状態。同じ列を押すたびに 昇順 → 降順 → 解除(null)、別の列を押すとその列の昇順。
 * rowsは押した時点の並べる対象の行で、並び替えの値をここで確定する(valueOfで列ごとの値を取り出す)。
 */
export function cycleTableSort<K extends string, R>(
  current: TableSort<K> | null,
  key: K,
  rows: readonly R[],
  valueOf: (key: K, row: R) => SortValue,
  idOf: (row: R) => SortRowId,
): TableSort<K> | null {
  const direction: SortDirection | null =
    current === null || current.key !== key ? 'asc' : current.direction === 'asc' ? 'desc' : null
  if (direction === null) return null
  return { key, direction, values: new Map(rows.map((row) => [idOf(row), valueOf(key, row)])) }
}

/**
 * 2行の比較。並び替えが無い・値が同じなら0を返すので、呼び出し側が元の順で決める。
 * 押した時点に無かった行(あとから現れた行)と未設定の値は、昇順でも降順でも最後に置く。
 * 文字は文字コードの順に比べる(環境による照合順の違いを避ける。厳密な五十音順ではなく、漢字は読みの順にならない)。
 */
export function compareByTableSort<K extends string>(sort: TableSort<K> | null, a: SortRowId, b: SortRowId): number {
  if (sort === null) return 0
  const x = sort.values.get(a) ?? null
  const y = sort.values.get(b) ?? null
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  const result = typeof x === 'number' && typeof y === 'number' ? x - y : x < y ? -1 : x > y ? 1 : 0
  return sort.direction === 'asc' ? result : -result
}
