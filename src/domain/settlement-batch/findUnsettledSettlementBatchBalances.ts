import type { AccountCategory } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import { calculateSettlementBatchBalance } from './calculateSettlementBatchBalance'

export interface UnsettledSettlementBatchBalance {
  householdMemberId: number | null
  counterpartyId: number | null
  balance: number
}

/**
 * 指定した精算バッチ・科目について、世帯メンバー/取引先ごとにグルーピングした未精算残高の
 * 一覧(docs/domain/settlement.md、計画Issue #133)。settlement_batch_id・account_idが一致する
 * 行を(household_member_id, counterparty_id)でグルーピングし、各グループの残高
 * (calculateSettlementBatchBalance)が0より大きいものだけを返す。DBアクセスなしの純粋関数。
 */
export function findUnsettledSettlementBatchBalances(
  lines: readonly JournalLine[],
  settlementBatchId: number,
  accountId: number,
  accountCategory: Extract<AccountCategory, 'asset' | 'liability'>,
): UnsettledSettlementBatchBalance[] {
  const groupKeys = new Map<string, { householdMemberId: number | null; counterpartyId: number | null }>()
  for (const line of lines) {
    if (line.settlementBatchId !== settlementBatchId || line.accountId !== accountId) continue
    const key = `${line.householdMemberId ?? 'null'}:${line.counterpartyId ?? 'null'}`
    if (!groupKeys.has(key)) {
      groupKeys.set(key, { householdMemberId: line.householdMemberId, counterpartyId: line.counterpartyId })
    }
  }

  return Array.from(groupKeys.values())
    .map((group) => ({
      ...group,
      balance: calculateSettlementBatchBalance(lines, accountCategory, {
        settlementBatchId,
        accountId,
        householdMemberId: group.householdMemberId,
        counterpartyId: group.counterpartyId,
      }),
    }))
    .filter((group) => group.balance > 0)
}
