/**
 * 1人の分担額を、符号付きの行の金額(借方+・貸方−)の比で各行へ配分する(計画Issue #271)。
 * 各行の配分は「分担額 × 行の金額 ÷ 行の金額の合計(純額)」で、符号は行の向きのまま。端数は最大剰余法で
 * 配る(小数部が大きい行から1円ずつ。同じ大きさなら先の行)。配分額の合計は必ず分担額と一致する。
 * 純額が0のときは配分の基準がないため、呼び出し側が事前に除くこと(その場合は全行0を返す)。
 * 全行が同じ向きなら、allocateAcrossLinesと同じ結果になる(貸方だけなら全行が負)。
 */
export function allocateSignedAcrossLines(totalAmount: number, signedLineAmounts: readonly number[]): number[] {
  const net = signedLineAmounts.reduce((sum, amount) => sum + amount, 0)
  if (net === 0) return signedLineAmounts.map(() => 0)
  const quotas = signedLineAmounts.map((amount) => (totalAmount * amount) / net)
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
