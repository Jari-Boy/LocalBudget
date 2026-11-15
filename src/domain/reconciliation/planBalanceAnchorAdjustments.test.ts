/**
 * planBalanceAnchorAdjustments の単体テスト(外部依存なしの純粋関数)。
 *
 * 検証対象: 科目ごとの基準点(日付 D の終わり時点の正しい残高)と帳簿の増減(符号付き)から、
 * 「あるべき自動調整の一覧」(元手=最初の基準点の差額 + 2つ目以降の区間ごとの差額)と
 * 照合表の行を計算する(計画Issue #205、docs/domain/reconciliation.md 1.5・1.6)。
 * 帳簿の増減は「科目の残高が増える向きを正」とした符号付きの値で渡す(資産・負債の向きは呼び出し側が吸収)。
 */
import { describe, expect, it } from 'vitest'
import { planBalanceAnchorAdjustments } from './planBalanceAnchorAdjustments'

describe('planBalanceAnchorAdjustments', () => {
  it('基準点が無ければ何も計画しない', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [],
      ledger: [{ date: '2026-01-05', delta: 1000 }],
      autoAdjust: true,
    })
    expect(plan.adjustments).toEqual([])
    expect(plan.rows).toEqual([])
  })

  it('最初の基準点の差額は元手として、基準点の日と一番古い仕訳の日のうち早い日付で計画する', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [{ date: '2026-01-10', balance: 10000 }],
      ledger: [
        { date: '2026-01-05', delta: 2000 },
        { date: '2026-01-20', delta: 500 },
      ],
      autoAdjust: true,
    })
    // D=1/10 の帳簿は 2000(1/20 は含めない)。差額 8000 が元手
    expect(plan.adjustments).toEqual([
      { kind: 'capital', entryDate: '2026-01-05', periodStart: null, periodEnd: '2026-01-10', amount: 8000 },
    ])
    expect(plan.rows[0]).toMatchObject({ date: '2026-01-10', anchorBalance: 10000, bookBalance: 2000, isCapital: true })
  })

  it('一番古い基準点より前に仕訳が無ければ元手の日付は基準点の日になる', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [{ date: '2026-01-10', balance: 10000 }],
      ledger: [{ date: '2026-01-20', delta: 500 }],
      autoAdjust: true,
    })
    expect(plan.adjustments[0]).toMatchObject({ kind: 'capital', entryDate: '2026-01-10', amount: 10000 })
  })

  it('帳簿が基準点と既に一致していれば元手も作らない', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [{ date: '2026-01-10', balance: 2000 }],
      ledger: [{ date: '2026-01-05', delta: 2000 }],
      autoAdjust: true,
    })
    expect(plan.adjustments).toEqual([])
  })

  it('2つ目以降の基準点は、帳簿の増減と基準点の増減の食い違いを区間の終わりの日付で調整する', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [
        { date: '2026-01-31', balance: 10000 },
        { date: '2026-02-28', balance: 13000 },
      ],
      ledger: [
        { date: '2026-01-31', delta: 10000 },
        { date: '2026-02-10', delta: 2000 },
      ],
      autoAdjust: true,
    })
    // 基準点は +3000、帳簿は +2000 → 区間 2/1〜2/28 で +1000 を調整
    expect(plan.adjustments).toEqual([
      { kind: 'adjustment', entryDate: '2026-02-28', periodStart: '2026-02-01', periodEnd: '2026-02-28', amount: 1000 },
    ])
    expect(plan.rows[1]).toMatchObject({ date: '2026-02-28', periodStart: '2026-02-01', adjustment: 1000, isCapital: false })
  })

  it('入力順によらず日付順に処理し、同じ日の基準点は後に渡したものを採用する', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [
        { date: '2026-02-28', balance: 13000 },
        { date: '2026-01-31', balance: 9999 },
        { date: '2026-01-31', balance: 10000 },
      ],
      ledger: [{ date: '2026-01-31', delta: 10000 }],
      autoAdjust: true,
    })
    expect(plan.rows.map((row) => row.date)).toEqual(['2026-01-31', '2026-02-28'])
    expect(plan.adjustments).toEqual([
      { kind: 'adjustment', entryDate: '2026-02-28', periodStart: '2026-02-01', periodEnd: '2026-02-28', amount: 3000 },
    ])
  })

  it('負の差額(帳簿が基準点より多い)は負の金額で計画する', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [
        { date: '2026-01-31', balance: 10000 },
        { date: '2026-02-28', balance: 10000 },
      ],
      ledger: [
        { date: '2026-01-31', delta: 10000 },
        { date: '2026-02-10', delta: 700 },
      ],
      autoAdjust: true,
    })
    expect(plan.adjustments).toEqual([
      { kind: 'adjustment', entryDate: '2026-02-28', periodStart: '2026-02-01', periodEnd: '2026-02-28', amount: -700 },
    ])
  })

  it('調整を適用すると、どの基準点の日でも帳簿が基準点に一致する', () => {
    const anchors = [
      { date: '2026-01-31', balance: 5000 },
      { date: '2026-02-28', balance: 8000 },
      { date: '2026-03-31', balance: 7000 },
    ]
    const ledger = [
      { date: '2026-01-10', delta: 3000 },
      { date: '2026-02-15', delta: 1000 },
      { date: '2026-03-15', delta: -2000 },
    ]
    const plan = planBalanceAnchorAdjustments({ anchors, ledger, autoAdjust: true })
    const all = [...ledger, ...plan.adjustments.map((a) => ({ date: a.entryDate, delta: a.amount }))]
    for (const anchor of anchors) {
      const book = all.filter((l) => l.date <= anchor.date).reduce((s, l) => s + l.delta, 0)
      expect(book).toBe(anchor.balance)
    }
  })

  it('自動調整オフでも元手は計画し、2つ目以降の差額は計画せず rows の discrepancy に載せる', () => {
    const plan = planBalanceAnchorAdjustments({
      anchors: [
        { date: '2026-01-31', balance: 10000 },
        { date: '2026-02-28', balance: 13000 },
      ],
      ledger: [
        { date: '2026-01-31', delta: 10000 },
        { date: '2026-02-10', delta: 2000 },
      ],
      autoAdjust: false,
    })
    expect(plan.adjustments).toEqual([])
    expect(plan.rows[1]).toMatchObject({ adjustment: 0, discrepancy: 1000 })
  })

  it('古い基準点が加わると元手の役が移り、旧元手の基準点の差額は通常の調整になる', () => {
    const ledger = [{ date: '2026-02-05', delta: 1000 }]
    const before = planBalanceAnchorAdjustments({
      anchors: [{ date: '2026-02-28', balance: 5000 }],
      ledger,
      autoAdjust: true,
    })
    expect(before.adjustments).toEqual([
      { kind: 'capital', entryDate: '2026-02-05', periodStart: null, periodEnd: '2026-02-28', amount: 4000 },
    ])

    const after = planBalanceAnchorAdjustments({
      anchors: [
        { date: '2026-01-31', balance: 3000 },
        { date: '2026-02-28', balance: 5000 },
      ],
      ledger,
      autoAdjust: true,
    })
    expect(after.adjustments).toEqual([
      { kind: 'capital', entryDate: '2026-01-31', periodStart: null, periodEnd: '2026-01-31', amount: 3000 },
      { kind: 'adjustment', entryDate: '2026-02-28', periodStart: '2026-02-01', periodEnd: '2026-02-28', amount: 1000 },
    ])
  })
})
