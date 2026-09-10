import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'

export interface ExpenseSplittingParticipant {
  householdMemberId: number | null
  counterpartyId: number | null
}

/**
 * 割勘仕訳(from_entry側にallocatesリンクを持つ仕訳)から分担者を特定する
 * (docs/domain/expense-splitting.md 1.3・1.4節)。世帯メンバー間の割勘は
 * 立替金(負債)行(is_system_managed=true)のhousehold_member_idが分担者、
 * 世帯外の相手との割勘は立替金(負債)行を持たず費用行のcounterparty_idが分担者になる
 * (buildHouseholdMemberExpenseSplittingJournalEntryInput・
 * buildCounterpartyExpenseSplittingJournalEntryInputが組み立てる行構成に対応)。
 * いずれの行も見つからない場合はundefinedを返す。DBアクセスなしの純粋関数。
 */
export function resolveExpenseSplittingParticipant(
  splitEntry: JournalEntry,
  accounts: readonly Account[],
): ExpenseSplittingParticipant | undefined {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const advanceLiabilityLine = splitEntry.lines.find((line) => {
    const account = accountsById.get(line.accountId)
    return account?.category === 'liability' && account.isSystemManaged
  })
  if (advanceLiabilityLine !== undefined) {
    return { householdMemberId: advanceLiabilityLine.householdMemberId, counterpartyId: null }
  }

  const counterpartyLine = splitEntry.lines.find((line) => line.counterpartyId !== null)
  if (counterpartyLine !== undefined) {
    return { householdMemberId: null, counterpartyId: counterpartyLine.counterpartyId }
  }

  return undefined
}
