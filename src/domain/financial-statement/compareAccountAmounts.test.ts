/**
 * compareAccountAmountsの純粋関数としてのユニットテスト。
 * FS画面の比較機能(docs/domain/financial-statements.md 2.2節「比較」、計画Issue #34)向けに、
 * 当期・前期(または前年同期)それぞれのAccountAmount[](科目別内訳)をaccountIdで
 * 突合し、当期額・比較期間額・差分を1行にまとめた配列を返す。どちらか一方にしか
 * 存在しない科目(比較期間には残高が無かった/当期になって新規発生した等)の扱いを
 * 中心に検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { compareAccountAmounts } from './compareAccountAmounts'

describe('compareAccountAmounts', () => {
  it('両期間に存在する科目は、当期額・比較期間額・差分をまとめた行を返す', () => {
    const current = [{ accountId: 1, accountName: '食費', amount: 5000 }]
    const comparison = [{ accountId: 1, accountName: '食費', amount: 3000 }]

    expect(compareAccountAmounts(current, comparison)).toEqual([
      { accountId: 1, accountName: '食費', currentAmount: 5000, comparisonAmount: 3000, difference: 2000 },
    ])
  })

  it('当期のみに存在する科目は、比較期間額0・差分=当期額として含める', () => {
    const current = [{ accountId: 1, accountName: '食費', amount: 5000 }]
    const comparison: typeof current = []

    expect(compareAccountAmounts(current, comparison)).toEqual([
      { accountId: 1, accountName: '食費', currentAmount: 5000, comparisonAmount: 0, difference: 5000 },
    ])
  })

  it('比較期間のみに存在する科目は、当期額0・差分=マイナス比較期間額として含める', () => {
    const current: { accountId: number; accountName: string; amount: number }[] = []
    const comparison = [{ accountId: 1, accountName: '食費', amount: 3000 }]

    expect(compareAccountAmounts(current, comparison)).toEqual([
      { accountId: 1, accountName: '食費', currentAmount: 0, comparisonAmount: 3000, difference: -3000 },
    ])
  })

  it('両期間とも空配列なら空配列を返す', () => {
    expect(compareAccountAmounts([], [])).toEqual([])
  })

  it('複数科目は当期配列の順序を優先し、当期に無い比較期間のみの科目は末尾に追加する', () => {
    const current = [
      { accountId: 2, accountName: '交通費', amount: 1000 },
      { accountId: 1, accountName: '食費', amount: 5000 },
    ]
    const comparison = [
      { accountId: 1, accountName: '食費', amount: 3000 },
      { accountId: 3, accountName: '娯楽費', amount: 2000 },
    ]

    const result = compareAccountAmounts(current, comparison)

    expect(result.map((r) => r.accountId)).toEqual([2, 1, 3])
  })
})
