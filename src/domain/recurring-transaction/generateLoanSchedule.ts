export type LoanMethod = 'annuity' | 'equal_principal'

export interface GenerateLoanScheduleParams {
  /** 借入額(通貨最小単位の正の整数) */
  principal: number
  /** 年利(固定、%)。0以上。0.01%単位で計算する */
  annualRatePercent: number
  /** 返済回数(毎月)。1以上の整数 */
  rounds: number
  /** annuity=元利均等、equal_principal=元金均等 */
  method: LoanMethod
}

export interface LoanScheduleRow {
  /** その回の元金 */
  principal: number
  /** その回の利息 */
  interest: number
}

/**
 * 元利均等・元金均等のローンの、回ごとの元金・利息を作る純粋関数(計画Issue #180、生成補助)。
 * - 毎月の利息は「残高 × 年利 ÷ 12」で1円未満切り捨て。年利は0.01%単位の整数(ベーシスポイント)に直して
 *   整数で計算し、浮動小数の誤差で利息がずれないようにする。
 * - 元利均等の毎月の返済額(元金+利息)は1円未満切り上げ。元金は 返済額 − 利息。
 * - 元金均等の元金は 借入額 ÷ 回数(1円未満切り捨て)。
 * - 最終回は端数を調整し、元金を残りの残高全額にする。元金の合計は借入額と一致する。
 * 日割りの利息は扱わない(ずれた行はユーザーが金額表で直す)。結果は「妥当な初期値」。
 */
export function generateLoanSchedule(params: GenerateLoanScheduleParams): LoanScheduleRow[] {
  const { principal, annualRatePercent, rounds, method } = params
  if (!Number.isInteger(principal) || principal <= 0) {
    throw new Error(`principal must be a positive integer: got ${principal}`)
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`rounds must be an integer of 1 or more: got ${rounds}`)
  }
  if (!Number.isFinite(annualRatePercent) || annualRatePercent < 0) {
    throw new Error(`annualRatePercent must be 0 or more: got ${annualRatePercent}`)
  }

  const basisPoints = Math.round(annualRatePercent * 100)
  const interestOf = (balance: number) => Math.floor((balance * basisPoints) / 120000)
  const annuityPayment = (): number => {
    if (basisPoints === 0) return Math.ceil(principal / rounds)
    const monthlyRate = basisPoints / 120000
    const payment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -rounds))
    // 浮動小数の誤差で、ちょうど割り切れる額が切り上がらないようにする
    return Math.ceil(payment - 1e-9)
  }

  const payment = method === 'annuity' ? annuityPayment() : 0
  const equalPrincipal = Math.floor(principal / rounds)

  const rows: LoanScheduleRow[] = []
  let balance = principal
  for (let round = 1; round <= rounds; round += 1) {
    const interest = interestOf(balance)
    const isLast = round === rounds
    let principalPart: number
    if (isLast) {
      principalPart = balance
    } else if (method === 'annuity') {
      // 返済額が利息を下回る(元金が負になる)ことはない金額だが、念のため0〜残高に収める
      principalPart = Math.min(balance, Math.max(0, payment - interest))
    } else {
      principalPart = Math.min(balance, equalPrincipal)
    }
    rows.push({ principal: principalPart, interest })
    balance -= principalPart
  }
  return rows
}
