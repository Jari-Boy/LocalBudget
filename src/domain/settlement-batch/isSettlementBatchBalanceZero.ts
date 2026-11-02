import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { calculateSettlementBatchBalance } from './calculateSettlementBatchBalance'

/**
 * 精算バッチの非アクティブ化提案の判定ロジック(docs/domain/projects.md 1.3節・1.5節相当、
 * project(kind='settlement')からsettlement_batchesへ移設、計画Issue #133)。
 * 対象バッチにタグ付けされた資産・負債科目の明細行を(account_id, household_member_id,
 * counterparty_id)でグルーピングし、すべてのグループの残高(calculateSettlementBatchBalance)が
 * 0になった状態を検出する。
 *
 * 紐づく資産・負債科目の明細が1件もない(未記帳)場合は、精算完了と区別するためfalseを返す
 * (精算残高0と未記帳を区別できないため)。この関数は判定結果(boolean)を返すのみで、
 * is_activeの変更は行わない。DB非依存の純粋関数。
 */
export function isSettlementBatchBalanceZero(
  batch: SettlementBatch,
  lines: readonly JournalLine[],
  accounts: readonly Account[],
): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const batchLines = lines.filter((line) => {
    if (line.settlementBatchId !== batch.id) return false
    const category = accountsById.get(line.accountId)?.category
    return category === 'asset' || category === 'liability'
  })

  if (batchLines.length === 0) return false

  const groupKeys = new Map<
    string,
    { accountId: number; householdMemberId: number | null; counterpartyId: number | null }
  >()
  for (const line of batchLines) {
    const key = `${line.accountId}:${line.householdMemberId ?? 'null'}:${line.counterpartyId ?? 'null'}`
    if (!groupKeys.has(key)) {
      groupKeys.set(key, {
        accountId: line.accountId,
        householdMemberId: line.householdMemberId,
        counterpartyId: line.counterpartyId,
      })
    }
  }

  return Array.from(groupKeys.values()).every((group) => {
    const category = accountsById.get(group.accountId)!.category as 'asset' | 'liability'
    return (
      calculateSettlementBatchBalance(lines, category, {
        settlementBatchId: batch.id,
        accountId: group.accountId,
        householdMemberId: group.householdMemberId,
        counterpartyId: group.counterpartyId,
      }) === 0
    )
  })
}
