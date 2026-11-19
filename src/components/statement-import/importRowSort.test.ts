/**
 * importRowSort(明細取込画面の一覧のヘッダーでの並び替え、計画Issue #231 フェーズ2)のユニットテスト。
 * ヘッダーを押すたびの 昇順→降順→解除 の切り替え、列ごとの並び替えの値(日付・摘要・金額・取込ファイル・相手科目・
 * 取引先・状態)、未設定の値は昇順でも降順でも最後に置くこと、ヘッダーを押した時点の値で並びを決める(押したあとに
 * 行の入力を変えても値は変わらない)こと、押した時点に無かった行は並びの最後に置くことを検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { compareBySort, cycleSort, type SortableRow } from './importRowSort'

const row = (externalId: string, overrides: Partial<SortableRow> = {}): SortableRow => ({
  externalId,
  fileName: 'a.csv',
  entryDate: '2026-10-05',
  description: 'スーパー',
  amount: -1000,
  counterAccountName: '',
  counterpartyName: '',
  status: 'check',
  ...overrides,
})

/** 並び替えの結果の externalId の並び(同じ値は元の順=配列の順を保つ) */
function order(sort: ReturnType<typeof cycleSort>, rows: SortableRow[]): string[] {
  const items = rows.map((r, index) => ({ externalId: r.externalId, index }))
  return [...items].sort((a, b) => compareBySort(sort, a, b) || a.index - b.index).map((i) => i.externalId)
}

describe('cycleSort', () => {
  const rows = [row('a')]

  it('同じ列を押すたびに 昇順 → 降順 → 解除 と切り替わる', () => {
    const asc = cycleSort(null, 'amount', rows)
    expect(asc).toMatchObject({ key: 'amount', direction: 'asc' })
    const desc = cycleSort(asc, 'amount', rows)
    expect(desc).toMatchObject({ key: 'amount', direction: 'desc' })
    expect(cycleSort(desc, 'amount', rows)).toBeNull()
  })

  it('別の列を押すと、その列の昇順から始まる', () => {
    const desc = cycleSort(cycleSort(null, 'amount', rows), 'amount', rows)
    expect(cycleSort(desc, 'date', rows)).toMatchObject({ key: 'date', direction: 'asc' })
  })
})

describe('compareBySort', () => {
  it('並び替えが無い(null)ときは比べない(0)ので、元の順のまま', () => {
    const rows = [row('a'), row('b')]
    expect(order(null, rows)).toEqual(['a', 'b'])
  })

  it('金額は数として、昇順では小さい(出金の大きい)順、降順では大きい順に並ぶ', () => {
    const rows = [row('a', { amount: -3000 }), row('b', { amount: 500 }), row('c', { amount: -12000 })]
    expect(order(cycleSort(null, 'amount', rows), rows)).toEqual(['c', 'a', 'b'])
    expect(order(cycleSort(cycleSort(null, 'amount', rows), 'amount', rows), rows)).toEqual(['b', 'a', 'c'])
  })

  it('日付は新旧の順に並ぶ', () => {
    const rows = [row('a', { entryDate: '2026-10-07' }), row('b', { entryDate: '2026-10-05' }), row('c', { entryDate: '2026-10-06' })]
    expect(order(cycleSort(null, 'date', rows), rows)).toEqual(['b', 'c', 'a'])
  })

  it('摘要・取込ファイル・相手科目・取引先は文字コード順に並ぶ', () => {
    const rows = [
      row('a', { description: 'ランチ', fileName: 'b.csv', counterAccountName: '食費', counterpartyName: 'スーパー' }),
      row('b', { description: 'あいう', fileName: 'a.csv', counterAccountName: '交通費', counterpartyName: 'ガス' }),
    ]
    expect(order(cycleSort(null, 'description', rows), rows)).toEqual(['b', 'a'])
    expect(order(cycleSort(null, 'file', rows), rows)).toEqual(['b', 'a'])
    expect(order(cycleSort(null, 'counterAccount', rows), rows)).toEqual(['b', 'a'])
    expect(order(cycleSort(null, 'counterparty', rows), rows)).toEqual(['b', 'a'])
  })

  it('状態は 要確認 → 新規 → 保存しない → 重複・除外 の順(昇順)に並ぶ', () => {
    const rows = [
      row('dup', { status: 'duplicate' }),
      row('new', { status: 'new' }),
      row('skip', { status: 'skipped' }),
      row('check', { status: 'check' }),
    ]
    expect(order(cycleSort(null, 'status', rows), rows)).toEqual(['check', 'new', 'skip', 'dup'])
  })

  it('未設定(相手科目・取引先が空)の行は、昇順でも降順でも最後に置く', () => {
    const rows = [row('empty', { counterAccountName: '' }), row('a', { counterAccountName: '食費' }), row('b', { counterAccountName: '交通費' })]
    const asc = cycleSort(null, 'counterAccount', rows)
    expect(order(asc, rows)).toEqual(['b', 'a', 'empty'])
    expect(order(cycleSort(asc, 'counterAccount', rows), rows)).toEqual(['a', 'b', 'empty'])
  })

  it('同じ値の行どうしは0を返すので、呼び出し側が元の順を保てる', () => {
    const rows = [row('a', { amount: -100 }), row('b', { amount: -100 }), row('c', { amount: -100 })]
    expect(order(cycleSort(null, 'amount', rows), rows)).toEqual(['a', 'b', 'c'])
  })

  it('ヘッダーを押した時点の値で決まり、そのあと行の値が変わっても並びは変わらない', () => {
    const rows = [row('a', { counterAccountName: '食費' }), row('b', { counterAccountName: '交通費' })]
    const asc = cycleSort(null, 'counterAccount', rows)
    expect(order(asc, rows)).toEqual(['b', 'a'])

    // 押したあとに、aの相手科目を「あ」に変えても(並びの値は押した時点のまま)並びは同じ
    const edited = [row('a', { counterAccountName: 'あ' }), rows[1]]
    expect(order(asc, edited)).toEqual(['b', 'a'])
  })

  it('押した時点に無かった行(あとから現れた行)は、並びの最後に置く', () => {
    const rows = [row('a', { amount: -300 }), row('b', { amount: -100 })]
    const asc = cycleSort(null, 'amount', rows)
    const later = [row('new', { amount: -9999 }), ...rows]
    expect(order(asc, later)).toEqual(['a', 'b', 'new'])
  })
})
