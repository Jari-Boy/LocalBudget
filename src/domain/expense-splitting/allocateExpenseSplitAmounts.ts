export interface ExpenseSplitShare {
  /** 分担者を識別する任意のキー(呼び出し側で一意になるように解決する) */
  key: string
  /** 総額に対する配分の重み(相対値、合計に対する割合として計算するため正規化不要) */
  weight: number
}

/**
 * 複数人割勘の按分計算(計画Issue #40、比率変更・複数人対応)。総額を分担者ごとの
 * 重み(weight)に応じて配分する。均等割は全員weight=1、カスタム比率はweightに
 * 入力比率をそのまま渡す。Math.roundで各分担者の額を先に確定し、割り切れない端数は
 * 立替者(payerKey)の配分額に寄せて吸収する(合計は必ず総額と一致する)。
 */
export function allocateExpenseSplitAmounts(
  totalAmount: number,
  shares: readonly ExpenseSplitShare[],
  payerKey: string,
): Map<string, number> {
  const totalWeight = shares.reduce((sum, share) => sum + share.weight, 0)

  let allocatedToOthers = 0
  const amounts = new Map<string, number>()
  for (const share of shares) {
    if (share.key === payerKey) continue
    const amount = Math.round((totalAmount * share.weight) / totalWeight)
    amounts.set(share.key, amount)
    allocatedToOthers += amount
  }
  amounts.set(payerKey, totalAmount - allocatedToOthers)

  // Mapの挿入順をsharesの並び順に揃える(テスト・UI表示での見やすさのため)
  const ordered = new Map<string, number>()
  for (const share of shares) {
    ordered.set(share.key, amounts.get(share.key) as number)
  }
  return ordered
}
