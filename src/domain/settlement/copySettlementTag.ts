import type { JournalEntry } from '../journal/JournalEntry'

export interface SettlementTag {
  projectId: number | null
  householdMemberId: number | null
}

/**
 * タグ付き一時勘定の消込時タグコピー(docs/domain/settlement.md 1.7)。
 * 確定した(to_entry, amount)の組ごとに、to_entry側の一時勘定行(settlementAccountId)の
 * project_id/household_member_idをそのまま返す。呼び出し側はこの結果を消込仕訳側の
 * 一時勘定行のタグとしてそのまま使う。1件の消込が複数のto_entryをまとめて消し込む場合(1:N)や、
 * 1件のto_entryを複数回に分けて消し込む場合(N:N)も、(to_entry, settlementAccountId)の組ごとに
 * 呼び出せばよい。
 */
export function copySettlementTag(toEntry: JournalEntry, settlementAccountId: number): SettlementTag {
  const temporaryLine = toEntry.lines.find((line) => line.accountId === settlementAccountId)
  if (!temporaryLine) {
    throw new Error(
      `toEntry(id=${toEntry.id}) has no line for settlementAccountId=${settlementAccountId}`,
    )
  }

  return {
    projectId: temporaryLine.projectId,
    householdMemberId: temporaryLine.householdMemberId,
  }
}
