import type { JournalLine } from '../journal/JournalEntry'
import type { HouseholdMember } from '../household-member/HouseholdMember'
import type { Counterparty } from '../counterparty/Counterparty'
import type { SettlementBatch } from './SettlementBatch'

export interface SettlementTargetOption {
  kind: 'householdMember' | 'counterparty'
  id: number
  name: string
}

/**
 * 精算画面(計画Issue #139)の「対象者」ドロップダウンの候補一覧を組み立てる純粋関数。
 * 世帯メンバーは立替金/未払金(advanceAccountIdsで渡される、is_system_managedの資産・負債)
 * 科目の明細行に現れるhousehold_member_idから収集する。取引先は、journal_lines.counterparty_idが
 * 資産・負債の行には設定できない(docs/domain/counterparties.md 1.2)ため、明細行ではなく
 * settlement_batches.counterparty_idから収集する(docs/domain/settlement.md)。
 * DBアクセスなしの純粋関数。
 */
export function listSettlementTargetOptions(
  lines: readonly JournalLine[],
  batches: readonly SettlementBatch[],
  householdMembers: readonly HouseholdMember[],
  counterparties: readonly Counterparty[],
  advanceAccountIds: readonly number[],
): SettlementTargetOption[] {
  const householdMemberById = new Map(householdMembers.map((member) => [member.id, member]))
  const counterpartyById = new Map(counterparties.map((counterparty) => [counterparty.id, counterparty]))

  const memberIds = new Set<number>()
  for (const line of lines) {
    if (line.householdMemberId !== null && advanceAccountIds.includes(line.accountId)) {
      memberIds.add(line.householdMemberId)
    }
  }

  const counterpartyIds = new Set<number>()
  for (const batch of batches) {
    if (batch.counterpartyId !== null) {
      counterpartyIds.add(batch.counterpartyId)
    }
  }

  const memberOptions: SettlementTargetOption[] = Array.from(memberIds)
    .map((id) => householdMemberById.get(id))
    .filter((member): member is HouseholdMember => member !== undefined)
    .map((member) => ({ kind: 'householdMember' as const, id: member.id, name: member.name }))

  const counterpartyOptions: SettlementTargetOption[] = Array.from(counterpartyIds)
    .map((id) => counterpartyById.get(id))
    .filter((counterparty): counterparty is Counterparty => counterparty !== undefined)
    .map((counterparty) => ({ kind: 'counterparty' as const, id: counterparty.id, name: counterparty.name }))

  return [...memberOptions, ...counterpartyOptions]
}
