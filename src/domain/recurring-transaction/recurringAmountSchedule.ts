import type { JournalLineSide } from '../journal/JournalEntry'
import { InvalidRecurringScheduleError } from './InvalidRecurringScheduleError'
import type { LoanScheduleRow } from './generateLoanSchedule'
import type { RecurringAmountMode, RecurringScheduleRound } from './RecurringTransactionRule'

/**
 * 「回ごとの金額表」(amount_mode = 'schedule'、計画Issue #180)まわりの純粋関数。
 * 金額表は回(1始まり・連続)×ルールの行ごとの金額で、n回目の提案は表のn回目の金額を使う。
 * ドメインは固定の金額だけを扱い、端数処理(償却・ローンの計算)は生成補助(generateLoanSchedule等)が受け持つ
 * (docs/domain/recurring-transactions.md 3.5)。DB非依存。
 */

/**
 * 回数の上限(提案の生成を止める件数)。金額の初期値が金額表のルールは、表の最後の回まで生成したら終了する
 * ので、表の長さと回数の上限の小さいほうになる(回数の上限は表の長さに自動で揃う)。上限なしはnull
 */
export function effectiveMaxOccurrences(rule: {
  amountMode: RecurringAmountMode
  maxOccurrences: number | null
  schedule: readonly RecurringScheduleRound[]
}): number | null {
  if (rule.amountMode !== 'schedule') return rule.maxOccurrences
  return rule.maxOccurrences === null ? rule.schedule.length : Math.min(rule.maxOccurrences, rule.schedule.length)
}

/** n回目の、行番号ごとの金額。表の長さを超える回(最後の回まで生成済み)はnull */
export function scheduleAmountsForRound(
  schedule: readonly RecurringScheduleRound[],
  round: number,
): Map<number, number> | null {
  const found = schedule.find((r) => r.round === round)
  return found === undefined ? null : new Map(found.amounts.map((a) => [a.lineNo, a.amount]))
}

/**
 * 保存時の金額表の検証。回が1から連続している・空でない、各回がルールの全行の金額を過不足なく持つ、
 * 金額は0以上の整数、各回の貸借が一致する(借方合計=貸方合計で、0より大きい)。違反はInvalidRecurringScheduleError
 */
export function assertValidAmountSchedule(
  lines: readonly { lineNo: number; side: JournalLineSide }[],
  schedule: readonly RecurringScheduleRound[],
): void {
  if (schedule.length === 0) {
    throw new InvalidRecurringScheduleError('amount schedule must have at least 1 round')
  }
  const sideByLineNo = new Map(lines.map((l) => [l.lineNo, l.side]))
  schedule.forEach((entry, index) => {
    if (entry.round !== index + 1) {
      throw new InvalidRecurringScheduleError(
        `amount schedule rounds must be consecutive from 1: expected ${index + 1}, got ${entry.round}`,
      )
    }
    const lineNos = entry.amounts.map((a) => a.lineNo)
    if (
      lineNos.length !== sideByLineNo.size ||
      new Set(lineNos).size !== lineNos.length ||
      lineNos.some((lineNo) => !sideByLineNo.has(lineNo))
    ) {
      throw new InvalidRecurringScheduleError(`round ${entry.round} must have an amount for every rule line`)
    }
    if (entry.amounts.some((a) => !Number.isInteger(a.amount) || a.amount < 0)) {
      throw new InvalidRecurringScheduleError(`round ${entry.round} has an amount that is not a non-negative integer`)
    }
    const total = (side: JournalLineSide) =>
      entry.amounts.filter((a) => sideByLineNo.get(a.lineNo) === side).reduce((sum, a) => sum + a.amount, 0)
    if (total('debit') !== total('credit') || total('debit') === 0) {
      throw new InvalidRecurringScheduleError(
        `round ${entry.round} is unbalanced: debit ${total('debit')} / credit ${total('credit')}`,
      )
    }
  })
}

/**
 * 各回の残高(その回の後に残る金額)。指定した行(ローンの元金の行・償却の償却費の行)の、それ以降の回の
 * 合計として都度求める(保存しない)。1行を直しても後の行は自動で再計算されず、表の値の合計が変わるだけ
 */
export function remainingBalances(schedule: readonly RecurringScheduleRound[], lineNo: number): number[] {
  const amountOf = (entry: RecurringScheduleRound) => entry.amounts.find((a) => a.lineNo === lineNo)?.amount ?? 0
  const balances: number[] = []
  let remaining = schedule.reduce((sum, entry) => sum + amountOf(entry), 0)
  for (const entry of schedule) {
    remaining -= amountOf(entry)
    balances.push(remaining)
  }
  return balances
}

/**
 * 「n回目以降を再計算」の結果を表に取り込む。n回目より前はそのまま、n回目以降を新しい回(1回目から
 * 始まる番号)に置き換え、n回目から順に番号を振り直す。回の数は変わりうる(残り回数の入力による)
 */
export function mergeScheduleFromRound(
  existing: readonly RecurringScheduleRound[],
  fromRound: number,
  replacement: readonly RecurringScheduleRound[],
): RecurringScheduleRound[] {
  const kept = existing.filter((entry) => entry.round < fromRound)
  const replaced = replacement.map((entry, index) => ({ ...entry, round: fromRound + index }))
  return [...kept, ...replaced]
}

/** ローンの生成補助の結果を金額表に写す。支払元の行は 元金+利息 */
export function loanScheduleRounds(
  rows: readonly LoanScheduleRow[],
  lineNos: { principalLineNo: number; interestLineNo: number; sourceLineNo: number },
): RecurringScheduleRound[] {
  return rows.map((row, index) => ({
    round: index + 1,
    amounts: [
      { lineNo: lineNos.principalLineNo, amount: row.principal },
      { lineNo: lineNos.interestLineNo, amount: row.interest },
      { lineNo: lineNos.sourceLineNo, amount: row.principal + row.interest },
    ],
  }))
}

/** 定額法の償却の生成補助の結果を金額表に写す。償却費の行と、貸方(累計額・資産)の行に同額を入れる */
export function straightLineScheduleRounds(
  amounts: readonly number[],
  lineNos: { expenseLineNo: number; creditLineNo: number },
): RecurringScheduleRound[] {
  return amounts.map((amount, index) => ({
    round: index + 1,
    amounts: [
      { lineNo: lineNos.expenseLineNo, amount },
      { lineNo: lineNos.creditLineNo, amount },
    ],
  }))
}
