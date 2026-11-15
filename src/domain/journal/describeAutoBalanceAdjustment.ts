import type { JournalEntry } from './JournalEntry'

export interface AutoBalanceAdjustmentDescription {
  /** capital: 最初の基準点の差額(元手、相手は初期残高)。adjustment: 2つ目以降の区間の調整(相手は残高調整) */
  kind: 'capital' | 'adjustment'
  /** 調整の対象になった科目(資産・負債) */
  accountId: number
  /** ずれた期間(YYYY-MM-DD)。元手はnull */
  periodStart: string | null
  periodEnd: string
}

/**
 * 自動調整仕訳(計画Issue #205)の詳細パネル用の情報を求める純粋関数。
 * 摘要は「残高の自動調整(科目名 MM/DD〜MM/DD)」の形で、期間の終わりは仕訳日、開始日の年は
 * 終わりの日付から補う(開始が終わりより後の月日なら前の年)。相手科目(システム管理の
 * 初期残高・残高調整)かどうかは呼び出し側が isCounterAccount で教える。
 */
export function describeAutoBalanceAdjustment(
  entry: JournalEntry,
  isCounterAccount: (accountId: number) => boolean,
): AutoBalanceAdjustmentDescription | null {
  if (entry.sourceType !== 'auto_balance_adjustment') return null
  const target = entry.lines.find((line) => !isCounterAccount(line.accountId))
  if (!target) return null

  const match = /(\d{2})\/(\d{2})〜(\d{2})\/(\d{2})/.exec(entry.memo ?? '')
  if (!match) {
    return { kind: 'capital', accountId: target.accountId, periodStart: null, periodEnd: entry.entryDate }
  }
  const endYear = Number(entry.entryDate.slice(0, 4))
  const startMonthDay = `${match[1]}-${match[2]}`
  const startYear = startMonthDay > entry.entryDate.slice(5) ? endYear - 1 : endYear
  return {
    kind: 'adjustment',
    accountId: target.accountId,
    periodStart: `${startYear}-${startMonthDay}`,
    periodEnd: entry.entryDate,
  }
}
