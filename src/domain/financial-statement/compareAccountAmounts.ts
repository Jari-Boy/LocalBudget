import type { AccountAmount } from './AccountAmount'

export interface AccountAmountComparison {
  accountId: number
  accountName: string
  currentAmount: number
  comparisonAmount: number
  difference: number
}

/**
 * FS画面の比較機能(docs/domain/financial-statements.md 2.2節「比較」、計画Issue #34)向けに、
 * 当期・比較期間(前期または前年同期)それぞれのAccountAmount[](科目別内訳)をaccountIdで
 * 突合し、当期額・比較期間額・差分を1行にまとめる。いずれか一方にしか登場しない科目
 * (比較期間には残高0で内訳から除外されていた等)は、無い側の額を0として扱う。
 * 行の並び順は当期の配列順を優先し、当期に無く比較期間のみに登場する科目は末尾に追加する。
 * DB非依存の純粋関数。
 */
export function compareAccountAmounts(
  current: readonly AccountAmount[],
  comparison: readonly AccountAmount[],
): AccountAmountComparison[] {
  const comparisonByAccountId = new Map(comparison.map((item) => [item.accountId, item]))
  const currentAccountIds = new Set(current.map((item) => item.accountId))

  const currentRows = current.map((item) => {
    const comparisonAmount = comparisonByAccountId.get(item.accountId)?.amount ?? 0
    return {
      accountId: item.accountId,
      accountName: item.accountName,
      currentAmount: item.amount,
      comparisonAmount,
      difference: item.amount - comparisonAmount,
    }
  })

  const comparisonOnlyRows = comparison
    .filter((item) => !currentAccountIds.has(item.accountId))
    .map((item) => ({
      accountId: item.accountId,
      accountName: item.accountName,
      currentAmount: 0,
      comparisonAmount: item.amount,
      difference: -item.amount,
    }))

  return [...currentRows, ...comparisonOnlyRows]
}
