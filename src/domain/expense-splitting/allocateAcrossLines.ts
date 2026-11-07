/**
 * 1人の分担額を、費用の行の金額比で各行へ配分する(計画Issue #149、費用の行が複数ある仕訳の割勘)。
 * 端数は最大剰余法で配る(各行の按分額の小数部が大きい行から1円ずつ。同じ大きさなら先の行を優先)。
 * 配分額の合計は必ず分担額と一致する(1円もずれない)。lineAmountsは正の金額を想定する。
 */
export function allocateAcrossLines(totalAmount: number, lineAmounts: readonly number[]): number[] {
  const lineTotal = lineAmounts.reduce((sum, amount) => sum + amount, 0)
  const quotas = lineAmounts.map((amount) => (totalAmount * amount) / lineTotal)
  const result = quotas.map((quota) => Math.floor(quota))

  let remainder = totalAmount - result.reduce((sum, amount) => sum + amount, 0)
  const byFraction = quotas
    .map((quota, index) => ({ index, fraction: quota - Math.floor(quota) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of byFraction) {
    if (remainder <= 0) break
    result[index] += 1
    remainder -= 1
  }
  return result
}
