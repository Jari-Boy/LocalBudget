/**
 * tableSort(表の列見出しでの並び替えの共通モデル、計画Issue #302)のユニットテスト。
 * 明細取込・仕訳一覧・割勘の3画面が共有する、見出しを押すたびの 昇順→降順→解除 の切り替え、押した時点の値で並びを決める
 * (押したあとに行の値が変わっても並びは動かない)こと、未設定の値と押した時点に無かった行は昇順でも降順でも最後に置くこと、
 * 文字は文字コード順・数は大小で比べることを検証する。行のid(文字列・数値)と並び替えの値は呼び出し側が与える。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { compareByTableSort, cycleTableSort, textSortValue, type SortValue } from './tableSort'

interface Row {
  id: number
  name: string
  amount: number
}

type Key = 'name' | 'amount'

const valueOf = (key: Key, row: Row): SortValue => (key === 'name' ? textSortValue(row.name) : row.amount)
const idOf = (row: Row) => row.id

const rows = [
  { id: 1, name: 'ランチ', amount: -300 },
  { id: 2, name: 'あいう', amount: 500 },
  { id: 3, name: '', amount: -12000 },
]

/** 並び替えの結果のidの並び(同じ値は元の順=配列の順を保つ) */
function order(sort: ReturnType<typeof cycleTableSort<Key, Row>>, target: readonly Row[]): number[] {
  return target
    .map((r, index) => ({ id: r.id, index }))
    .sort((a, b) => compareByTableSort(sort, a.id, b.id) || a.index - b.index)
    .map((r) => r.id)
}

describe('cycleTableSort', () => {
  it('同じ列を押すたびに 昇順 → 降順 → 解除 と切り替わる', () => {
    const asc = cycleTableSort(null, 'amount', rows, valueOf, idOf)
    expect(asc).toMatchObject({ key: 'amount', direction: 'asc' })
    const desc = cycleTableSort(asc, 'amount', rows, valueOf, idOf)
    expect(desc).toMatchObject({ key: 'amount', direction: 'desc' })
    expect(cycleTableSort(desc, 'amount', rows, valueOf, idOf)).toBeNull()
  })

  it('別の列を押すと、その列の昇順から始まる', () => {
    const desc = cycleTableSort(cycleTableSort(null, 'amount', rows, valueOf, idOf), 'amount', rows, valueOf, idOf)
    expect(cycleTableSort(desc, 'name', rows, valueOf, idOf)).toMatchObject({ key: 'name', direction: 'asc' })
  })
})

describe('compareByTableSort', () => {
  it('並び替えが無い(null)ときは比べない(0)ので、元の順のまま', () => {
    expect(order(null, rows)).toEqual([1, 2, 3])
  })

  it('数は大小で比べ、昇順では小さい順、降順では大きい順に並ぶ', () => {
    const asc = cycleTableSort(null, 'amount', rows, valueOf, idOf)
    expect(order(asc, rows)).toEqual([3, 1, 2])
    expect(order(cycleTableSort(asc, 'amount', rows, valueOf, idOf), rows)).toEqual([2, 1, 3])
  })

  it('文字は文字コード順に比べ、未設定(空)の行は昇順でも降順でも最後に置く', () => {
    const asc = cycleTableSort(null, 'name', rows, valueOf, idOf)
    expect(order(asc, rows)).toEqual([2, 1, 3])
    expect(order(cycleTableSort(asc, 'name', rows, valueOf, idOf), rows)).toEqual([1, 2, 3])
  })

  it('同じ値の行どうしは0を返すので、呼び出し側が元の順を保てる', () => {
    const same = [
      { id: 1, name: 'a', amount: -100 },
      { id: 2, name: 'b', amount: -100 },
    ]
    const sort = cycleTableSort(null, 'amount', same, valueOf, idOf)
    expect(compareByTableSort(sort, 1, 2)).toBe(0)
  })

  it('ヘッダーを押した時点の値で決まり、そのあと行の値が変わっても並びは変わらない', () => {
    const asc = cycleTableSort(null, 'amount', rows, valueOf, idOf)
    expect(order(asc, rows)).toEqual([3, 1, 2])
    // 押したあとに id=3 の金額を大きく変えても、並びの値は押した時点のまま
    const edited = [rows[0], rows[1], { id: 3, name: '', amount: 99999 }]
    expect(order(asc, edited)).toEqual([3, 1, 2])
  })

  it('押した時点に無かった行(あとから現れた行)は、昇順でも降順でも最後に置く', () => {
    const base = rows.slice(0, 2)
    const asc = cycleTableSort(null, 'amount', base, valueOf, idOf)
    const later = [{ id: 9, name: 'x', amount: -99999 }, ...base]
    expect(order(asc, later)).toEqual([1, 2, 9])
    const desc = cycleTableSort(asc, 'amount', base, valueOf, idOf)
    expect(order(desc, later)).toEqual([2, 1, 9])
  })

  it('idが文字列でも数値でも同じように扱える', () => {
    const items = [
      { id: 'b', amount: 2 },
      { id: 'a', amount: 1 },
    ]
    const sort = cycleTableSort(null, 'amount', items, (_k: 'amount', r) => r.amount, (r) => r.id)
    expect(compareByTableSort(sort, 'a', 'b')).toBeLessThan(0)
  })
})

describe('textSortValue', () => {
  it('空文字は未設定(null)にし、それ以外はそのまま返す', () => {
    expect(textSortValue('')).toBeNull()
    expect(textSortValue('食費')).toBe('食費')
  })
})
