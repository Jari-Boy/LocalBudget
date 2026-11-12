/** 残存価額の既定。1円の備忘価額(計画Issue #180) */
export const DEFAULT_RESIDUAL_VALUE = 1

export interface GenerateStraightLineScheduleParams {
  /** 取得価額(通貨最小単位の正の整数) */
  acquisitionCost: number
  /** 残存価額。既定は1円の備忘価額。0以上で、取得価額より小さい */
  residualValue?: number
  /** 償却の回数(毎月の償却が前提)。1以上の整数 */
  rounds: number
}

/**
 * 定額法の償却の、回ごとの金額を作る純粋関数(計画Issue #180、生成補助)。
 * 「(取得価額 − 残存価額) ÷ 回数」で均等に割り、1円未満の端数は最終回に寄せる。合計は
 * 「取得価額 − 残存価額」と一致する。税法の定額法償却率は使わない(前払費用の按分にも使えるようにするため)。
 * 結果はあくまで「妥当な初期値」で、ユーザーが金額表を編集する前提。ドメインのルールは固定の金額だけを
 * 扱い、端数処理はこの生成補助が受け持つ(docs/domain/recurring-transactions.md 3.5)。
 */
export function generateStraightLineSchedule(params: GenerateStraightLineScheduleParams): number[] {
  const { acquisitionCost, rounds } = params
  const residualValue = params.residualValue ?? DEFAULT_RESIDUAL_VALUE
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error(`rounds must be an integer of 1 or more: got ${rounds}`)
  }
  if (!Number.isInteger(acquisitionCost) || !Number.isInteger(residualValue) || residualValue < 0) {
    throw new Error('acquisitionCost and residualValue must be integers, and residualValue must not be negative')
  }
  const depreciable = acquisitionCost - residualValue
  if (depreciable <= 0) {
    throw new Error(`acquisitionCost must be greater than residualValue: got ${acquisitionCost} / ${residualValue}`)
  }

  const base = Math.floor(depreciable / rounds)
  const amounts = Array.from({ length: rounds }, () => base)
  amounts[rounds - 1] = depreciable - base * (rounds - 1)
  return amounts
}
