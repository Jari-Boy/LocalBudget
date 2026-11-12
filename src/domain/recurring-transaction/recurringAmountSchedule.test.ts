/**
 * recurringAmountSchedule(定期仕訳の「回ごとの金額表」まわりの純粋関数)のユニットテスト。計画Issue #180の
 * 決定を検証する: 金額表は回(1始まり・連続)×ルールの行ごとの金額で、n回目の提案は表のn回目の金額を使い、
 * 回数の上限は表の長さに自動で揃う。保存時に各回の貸借が一致すること(仕訳と同じ検証)、各回の残高は
 * 保存せず都度計算すること、「n回目以降を再計算」で表のn回目以降だけが作り直されること、償却・ローンの
 * 生成補助の結果が行の金額表に写されること。外部依存なし(DB非依存)。
 */
import { describe, expect, it } from 'vitest'
import { InvalidRecurringScheduleError } from './InvalidRecurringScheduleError'
import type { RecurringScheduleRound } from './RecurringTransactionRule'
import {
  assertValidAmountSchedule,
  effectiveMaxOccurrences,
  loanScheduleRounds,
  mergeScheduleFromRound,
  remainingBalances,
  scheduleAmountsForRound,
  straightLineScheduleRounds,
} from './recurringAmountSchedule'

/** 行1: 借方(元金)、行2: 借方(利息)、行3: 貸方(支払元) */
const LOAN_LINES = [
  { lineNo: 1, side: 'debit' as const },
  { lineNo: 2, side: 'debit' as const },
  { lineNo: 3, side: 'credit' as const },
]

function round(n: number, principal: number, interest: number): RecurringScheduleRound {
  return {
    round: n,
    amounts: [
      { lineNo: 1, amount: principal },
      { lineNo: 2, amount: interest },
      { lineNo: 3, amount: principal + interest },
    ],
  }
}

describe('effectiveMaxOccurrences(回数の上限は表の長さに自動で揃う)', () => {
  it('金額の初期値が金額表のときは、表の長さと回数の上限の小さいほうになる', () => {
    const schedule = [round(1, 1, 1), round(2, 1, 1), round(3, 1, 1)]

    expect(effectiveMaxOccurrences({ amountMode: 'schedule', maxOccurrences: null, schedule })).toBe(3)
    expect(effectiveMaxOccurrences({ amountMode: 'schedule', maxOccurrences: 2, schedule })).toBe(2)
    expect(effectiveMaxOccurrences({ amountMode: 'schedule', maxOccurrences: 10, schedule })).toBe(3)
  })

  it('金額表でないルールは、回数の上限のまま(上限なしならnull)', () => {
    expect(effectiveMaxOccurrences({ amountMode: 'fixed', maxOccurrences: null, schedule: [] })).toBeNull()
    expect(effectiveMaxOccurrences({ amountMode: 'last_confirmed', maxOccurrences: 12, schedule: [] })).toBe(12)
  })
})

describe('scheduleAmountsForRound(n回目の提案は表のn回目の金額を使う)', () => {
  const schedule = [round(1, 100, 10), round(2, 102, 8)]

  it('生成済みの件数+1回目の金額を、行番号ごとの対応で返す', () => {
    expect(scheduleAmountsForRound(schedule, 2)).toEqual(
      new Map([
        [1, 102],
        [2, 8],
        [3, 110],
      ]),
    )
  })

  it('表の長さを超える回(最後の回まで生成済み)はnullを返す', () => {
    expect(scheduleAmountsForRound(schedule, 3)).toBeNull()
  })
})

describe('assertValidAmountSchedule(保存時の検証)', () => {
  it('回が1から連続し、各回が全行の金額を持ち、貸借が一致する表は有効', () => {
    expect(() => assertValidAmountSchedule(LOAN_LINES, [round(1, 100, 10), round(2, 102, 8)])).not.toThrow()
  })

  it('空の表は無効', () => {
    expect(() => assertValidAmountSchedule(LOAN_LINES, [])).toThrow(InvalidRecurringScheduleError)
  })

  it('回が1から連続していない表は無効', () => {
    expect(() => assertValidAmountSchedule(LOAN_LINES, [round(2, 1, 1)])).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidAmountSchedule(LOAN_LINES, [round(1, 1, 1), round(3, 1, 1)])).toThrow(
      InvalidRecurringScheduleError,
    )
  })

  it('ある回がルールの行の金額を欠く・余分な行を持つ表は無効', () => {
    const missing: RecurringScheduleRound = { round: 1, amounts: [{ lineNo: 1, amount: 5 }] }
    const extra: RecurringScheduleRound = { round: 1, amounts: [...round(1, 1, 1).amounts, { lineNo: 9, amount: 1 }] }

    expect(() => assertValidAmountSchedule(LOAN_LINES, [missing])).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidAmountSchedule(LOAN_LINES, [extra])).toThrow(InvalidRecurringScheduleError)
  })

  it('金額が負・小数の表は無効(0は有効。利息が0の回がある)', () => {
    const bad = { round: 1, amounts: [{ lineNo: 1, amount: -1 }, { lineNo: 2, amount: 0 }, { lineNo: 3, amount: -1 }] }
    const fraction = { round: 1, amounts: [{ lineNo: 1, amount: 1.5 }, { lineNo: 2, amount: 0 }, { lineNo: 3, amount: 1.5 }] }

    expect(() => assertValidAmountSchedule(LOAN_LINES, [bad])).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidAmountSchedule(LOAN_LINES, [fraction])).toThrow(InvalidRecurringScheduleError)
    expect(() => assertValidAmountSchedule(LOAN_LINES, [round(1, 100, 0)])).not.toThrow()
  })

  it('貸借が一致しない回がある表は無効(1行を直して合計がずれた回を拒否する)', () => {
    const off: RecurringScheduleRound = {
      round: 2,
      amounts: [{ lineNo: 1, amount: 100 }, { lineNo: 2, amount: 10 }, { lineNo: 3, amount: 111 }],
    }

    expect(() => assertValidAmountSchedule(LOAN_LINES, [round(1, 100, 10), off])).toThrow(InvalidRecurringScheduleError)
  })
})

describe('remainingBalances(各回の残高。保存せず都度計算)', () => {
  it('指定した行(元金・償却)について、その回の後に残る金額(それ以降の回の合計)を返す', () => {
    const schedule = [round(1, 100, 10), round(2, 102, 8), round(3, 98, 4)]

    expect(remainingBalances(schedule, 1)).toEqual([200, 98, 0])
  })

  it('1行を直しても、後の行は自動で再計算されない(残高は表の値から都度求めるだけ)', () => {
    const edited = [round(1, 100, 10), round(2, 90, 8), round(3, 98, 4)]

    expect(remainingBalances(edited, 1)).toEqual([188, 98, 0])
  })
})

describe('mergeScheduleFromRound(「n回目以降を再計算」)', () => {
  it('n回目より前はそのまま、n回目以降を新しい回に置き換える(回の数は変わりうる)', () => {
    const existing = [round(1, 100, 10), round(2, 100, 10), round(3, 100, 10)]
    const replacement = [round(1, 150, 5), round(2, 150, 3)]

    const merged = mergeScheduleFromRound(existing, 2, replacement)

    expect(merged.map((r) => r.round)).toEqual([1, 2, 3])
    expect(merged[0]).toEqual(round(1, 100, 10))
    expect(merged[1].amounts[0].amount).toBe(150)
    expect(merged[2].amounts[1].amount).toBe(3)
  })

  it('置き換える回は、n回目から順に番号を振り直す', () => {
    const merged = mergeScheduleFromRound([round(1, 1, 1)], 2, [round(1, 2, 2), round(2, 3, 3)])

    expect(merged.map((r) => r.round)).toEqual([1, 2, 3])
  })
})

describe('生成補助の結果を金額表に写す', () => {
  it('ローン: 元金の行・利息の行・支払元の行の金額表になる(支払元は 元金+利息)', () => {
    const rounds = loanScheduleRounds(
      [
        { principal: 100, interest: 10 },
        { principal: 102, interest: 8 },
      ],
      { principalLineNo: 1, interestLineNo: 2, sourceLineNo: 3 },
    )

    expect(rounds).toEqual([round(1, 100, 10), round(2, 102, 8)])
  })

  it('定額法の償却: 償却費の行と、貸方(累計額・資産)の行に同額を入れる', () => {
    const rounds = straightLineScheduleRounds([500, 500, 501], { expenseLineNo: 1, creditLineNo: 2 })

    expect(rounds).toEqual([
      { round: 1, amounts: [{ lineNo: 1, amount: 500 }, { lineNo: 2, amount: 500 }] },
      { round: 2, amounts: [{ lineNo: 1, amount: 500 }, { lineNo: 2, amount: 500 }] },
      { round: 3, amounts: [{ lineNo: 1, amount: 501 }, { lineNo: 2, amount: 501 }] },
    ])
  })
})
