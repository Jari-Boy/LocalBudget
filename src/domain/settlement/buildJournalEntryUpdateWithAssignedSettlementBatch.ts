import type { JournalEntry, UpdateJournalEntryInput } from '../journal/JournalEntry'

/**
 * 精算画面(計画Issue #139)で、選んだ候補仕訳の対象行にsettlement_batch_idを割り当てる
 * UpdateJournalEntryInputを組み立てる純粋関数。JournalEntryRepository.updateは明細行のidによる
 * 差分更新(docs/domain/journal.md)のため、対象行以外もidを含めてそのまま渡し、意図しない
 * 削除・新規作成を起こさない。対象行(lineId)だけsettlementBatchIdを書き換える。DBアクセスなし。
 */
export function buildJournalEntryUpdateWithAssignedSettlementBatch(
  entry: JournalEntry,
  lineId: number,
  settlementBatchId: number,
): UpdateJournalEntryInput {
  return {
    entryDate: entry.entryDate,
    memo: entry.memo,
    lines: entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      projectId: line.projectId,
      householdMemberId: line.householdMemberId,
      counterpartyId: line.counterpartyId,
      settlementBatchId: line.id === lineId ? settlementBatchId : line.settlementBatchId,
      side: line.side,
      amount: line.amount,
    })),
  }
}
