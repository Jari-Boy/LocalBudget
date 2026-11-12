import { useState } from 'react'
import type { JournalLineSide } from '../../domain/journal/JournalEntry'
import { generateLoanSchedule, type LoanMethod } from '../../domain/recurring-transaction/generateLoanSchedule'
import { generateStraightLineSchedule } from '../../domain/recurring-transaction/generateStraightLineSchedule'
import {
  loanScheduleRounds,
  mergeScheduleFromRound,
  remainingBalances,
  straightLineScheduleRounds,
} from '../../domain/recurring-transaction/recurringAmountSchedule'
import type { RecurringScheduleRound } from '../../domain/recurring-transaction/RecurringTransactionRule'
import './RuleAmountSchedulePanel.css'

export interface RuleAmountSchedulePanelLine {
  side: JournalLineSide
  accountName: string
}

export interface RuleAmountSchedulePanelProps {
  /** ルールの行(行番号は並び順の1始まり)。表の列と、生成補助で行を選ぶ欄に使う */
  lines: readonly RuleAmountSchedulePanelLine[]
  schedule: readonly RecurringScheduleRound[]
  onChange: (schedule: RecurringScheduleRound[]) => void
  /** 確定済みの回の数(生成済みの件数)。この回までの行は編集できない */
  confirmedRounds: number
  /** 各回の期日(土日の調整前)。回の数より短くてもよい */
  dueDates: readonly string[]
}

type GeneratorKind = 'straight_line' | 'annuity' | 'equal_principal'

const SIDE_LABEL: Record<JournalLineSide, string> = { debit: '借方', credit: '貸方' }

/** 金額の入力欄の値(数字だけ)を、0以上の整数にする。空は0 */
function parseAmount(value: string): number {
  const digits = value.replace(/[^0-9]/g, '')
  return digits === '' ? 0 : Number(digits)
}

/**
 * 回ごとの金額表の編集パネル(計画Issue #180、金額の初期値が「回ごとの金額表」のルールだけに出す)。
 * - 回ごとに各行の金額を表の形で直接編集できる(紙の償還表と見比べてずれた行を直す使い方)。1行を直しても
 *   後の行は自動では再計算しない。確定済みの回の行は編集できない。
 * - 各回の残高は、選んだ行(既定は最初の借方の行。ローンの元金・償却費)のそれ以降の回の合計として、保存せず
 *   表示のたびに求める。
 * - 生成補助: 定額法の償却・元利均等・元金均等のローンの条件から、表を作る(結果は初期値で、あとで編集できる)。
 *   確定済みの回があるときは使えず、「n回目以降を再計算」を使う。
 * - 「n回目以降を再計算」: 更新時の残高・年利・残り回数(償却なら残存価額)を入力し直し、n回目以降だけを作り直す
 *   (金利の見直し・繰上返済のあと)。残高は銀行の通知の値を入力し、帳簿から逆算しない。
 */
export function RuleAmountSchedulePanel({
  lines,
  schedule,
  onChange,
  confirmedRounds,
  dueDates,
}: RuleAmountSchedulePanelProps) {
  const [kind, setKind] = useState<GeneratorKind>('annuity')
  const [balanceLineNo, setBalanceLineNo] = useState(() => Math.max(1, lines.findIndex((l) => l.side === 'debit') + 1))
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [rounds, setRounds] = useState('')
  const [residual, setResidual] = useState('1')
  const [lineNos, setLineNos] = useState({ principal: '', interest: '', source: '', expense: '', credit: '' })
  const [fromRound, setFromRound] = useState(String(confirmedRounds + 1))
  const [balance, setBalance] = useState('')
  const [newRate, setNewRate] = useState('')
  const [remaining, setRemaining] = useState('')
  const [error, setError] = useState('')

  const balances = remainingBalances(schedule, balanceLineNo)
  const isLoan = kind !== 'straight_line'
  const lineOptions = lines.map((l, index) => (
    <option key={index} value={index + 1}>{`${index + 1}: ${SIDE_LABEL[l.side]} ${l.accountName}`}</option>
  ))
  const lineSelect = (label: string, key: keyof typeof lineNos) => (
    <label className="rule-schedule__field">
      {label}
      <select
        className="rule-schedule__control"
        value={lineNos[key]}
        onChange={(e) => setLineNos((current) => ({ ...current, [key]: e.target.value }))}
      >
        <option value="">選択してください</option>
        {lineOptions}
      </select>
    </label>
  )
  const numberField = (label: string, value: string, onValue: (v: string) => void) => (
    <label className="rule-schedule__field">
      {label}
      <input className="rule-schedule__control" inputMode="decimal" value={value} onChange={(e) => onValue(e.target.value)} />
    </label>
  )

  /** 条件の入力から、(1回目から始まる)回ごとの金額を作る。入力が足りなければエラー */
  const buildRounds = (base: number, ratePercent: number, count: number): RecurringScheduleRound[] => {
    if (isLoan) {
      const need = [lineNos.principal, lineNos.interest, lineNos.source]
      if (need.some((n) => n === '')) throw new Error('元金・利息・支払元の行を選んでください')
      const rows = generateLoanSchedule({
        principal: base,
        annualRatePercent: ratePercent,
        rounds: count,
        method: kind as LoanMethod,
      })
      return loanScheduleRounds(rows, {
        principalLineNo: Number(lineNos.principal),
        interestLineNo: Number(lineNos.interest),
        sourceLineNo: Number(lineNos.source),
      })
    }
    if (lineNos.expense === '' || lineNos.credit === '') throw new Error('償却費・貸方の行を選んでください')
    const amounts = generateStraightLineSchedule({
      acquisitionCost: base,
      residualValue: parseAmount(residual),
      rounds: count,
    })
    return straightLineScheduleRounds(amounts, {
      expenseLineNo: Number(lineNos.expense),
      creditLineNo: Number(lineNos.credit),
    })
  }

  const attempt = (action: () => void) => {
    setError('')
    try {
      action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const generate = () =>
    attempt(() => onChange(buildRounds(parseAmount(principal), Number(rate === '' ? '0' : rate), parseAmount(rounds))))

  const recalculate = () =>
    attempt(() => {
      const from = parseAmount(fromRound)
      if (from <= confirmedRounds) throw new Error('確定済みの回は再計算できません')
      if (from > schedule.length + 1) throw new Error('表の最後の回より先からは再計算できません')
      const replacement = buildRounds(parseAmount(balance), Number(newRate === '' ? '0' : newRate), parseAmount(remaining))
      onChange(mergeScheduleFromRound(schedule, from, replacement))
    })

  const setCell = (roundIndex: number, lineNo: number, value: string) =>
    onChange(
      schedule.map((entry, index) =>
        index !== roundIndex
          ? entry
          : { ...entry, amounts: entry.amounts.map((a) => (a.lineNo === lineNo ? { ...a, amount: parseAmount(value) } : a)) },
      ),
    )

  const unbalanced = schedule.filter((entry) => {
    const total = (side: JournalLineSide) =>
      entry.amounts.filter((a) => lines[a.lineNo - 1]?.side === side).reduce((sum, a) => sum + a.amount, 0)
    return total('debit') !== total('credit')
  })

  return (
    <section className="rule-schedule" aria-label="回ごとの金額表の編集">
      <h3 className="rule-schedule__title">{`回ごとの金額表(全${schedule.length}回・直接編集できます)`}</h3>
      <div className="rule-schedule__scroll">
        <table className="rule-schedule__table" aria-label="回ごとの金額表">
          <thead>
            <tr>
              <th>回</th>
              <th>期日</th>
              {lines.map((l, index) => (
                <th key={index} className="rule-schedule__num">
                  {`${SIDE_LABEL[l.side]} ${l.accountName}`}
                </th>
              ))}
              <th className="rule-schedule__num">残高(計算)</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((entry, roundIndex) => {
              const confirmed = entry.round <= confirmedRounds
              const isNext = entry.round === confirmedRounds + 1
              return (
                <tr
                  key={entry.round}
                  className={confirmed ? 'rule-schedule__row--done' : isNext ? 'rule-schedule__row--next' : undefined}
                >
                  <td>{entry.round}</td>
                  <td>{dueDates[roundIndex] ?? ''}</td>
                  {lines.map((l, index) => (
                    <td key={index}>
                      <input
                        className="rule-schedule__cell"
                        inputMode="numeric"
                        aria-label={`${entry.round}回目 ${l.accountName}の金額`}
                        disabled={confirmed}
                        value={String(entry.amounts.find((a) => a.lineNo === index + 1)?.amount ?? 0)}
                        onChange={(e) => setCell(roundIndex, index + 1, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="rule-schedule__num">{balances[roundIndex]}</td>
                  <td>{confirmed ? '確定済み' : '未確定'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <label className="rule-schedule__field rule-schedule__field--inline">
        残高を見る行
        <select
          className="rule-schedule__control"
          value={balanceLineNo}
          onChange={(e) => setBalanceLineNo(Number(e.target.value))}
        >
          {lineOptions}
        </select>
      </label>
      <p className="rule-schedule__note">
        1行を直しても、後の行は自動では再計算しません。確定済みの回(灰色)は編集できません。
      </p>
      {unbalanced.map((entry) => (
        <p key={entry.round} className="rule-schedule__warn">{`${entry.round}回目: 借方と貸方の合計が一致していません`}</p>
      ))}

      <fieldset className="rule-schedule__box">
        <legend>表の生成補助</legend>
        <div className="rule-schedule__radios">
          {(
            [
              ['straight_line', '定額法の償却'],
              ['annuity', '元利均等ローン'],
              ['equal_principal', '元金均等ローン'],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="rule-schedule-kind" checked={kind === value} onChange={() => setKind(value)} />
              {label}
            </label>
          ))}
        </div>
        <div className="rule-schedule__grid">
          {isLoan ? (
            <>
              {lineSelect('元金の行', 'principal')}
              {lineSelect('利息の行', 'interest')}
              {lineSelect('支払元の行', 'source')}
            </>
          ) : (
            <>
              {lineSelect('償却費の行', 'expense')}
              {lineSelect('貸方の行', 'credit')}
              {numberField('残存価額', residual, setResidual)}
            </>
          )}
        </div>
        <div className="rule-schedule__grid">
          {numberField(isLoan ? '借入額' : '取得価額', principal, setPrincipal)}
          {isLoan && numberField('年利(%)', rate, setRate)}
          {numberField(isLoan ? '返済回数' : '償却回数', rounds, setRounds)}
        </div>
        <p className="rule-schedule__note">
          {isLoan
            ? '利息は 残高×年利÷12 の1円未満切り捨て、元利均等の返済額は1円未満切り上げ、端数は最終回で調整します。日割りの利息は扱いません。'
            : '(取得価額−残存価額)÷回数で均等に割り、1円未満の端数は最終回に寄せます。毎月の償却が前提です。'}
        </p>
        <button type="button" className="rule-schedule__button" disabled={confirmedRounds > 0} onClick={generate}>
          表を作成
        </button>
        {confirmedRounds > 0 && <p className="rule-schedule__note">確定済みの回があるときは、下の「n回目以降を再計算」を使います。</p>}
      </fieldset>

      <fieldset className="rule-schedule__box">
        <legend>n回目以降を再計算(金利の見直し・繰上返済のあと)</legend>
        <div className="rule-schedule__grid">
          {numberField('何回目から', fromRound, setFromRound)}
          {numberField('更新時の残高', balance, setBalance)}
          {isLoan && numberField('新しい年利(%)', newRate, setNewRate)}
          {numberField('残り回数', remaining, setRemaining)}
        </div>
        <p className="rule-schedule__note">
          更新時の残高は銀行の通知の値を入力してください(帳簿から逆算しません)。繰上返済そのものは、通常の仕訳として手入力で起票します。
        </p>
        <button type="button" className="rule-schedule__button" onClick={recalculate}>
          {`${parseAmount(fromRound)}回目以降を再計算`}
        </button>
      </fieldset>

      {error !== '' && (
        <p role="alert" className="rule-schedule__error">
          {error}
        </p>
      )}
    </section>
  )
}
