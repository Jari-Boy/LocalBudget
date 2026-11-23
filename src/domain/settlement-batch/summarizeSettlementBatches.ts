import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { summarizeSettlementBatch, type SettlementBatchSummary } from './summarizeSettlementBatch'

/**
 * 全バッチの集計(計画Issue #249)。バッチごとに全明細行を絞り込む(バッチ数 × 明細行数)のをやめ、
 * 明細行を1回走査してバッチのタグごとに振り分けてから、バッチごとに集計する。結果は
 * バッチごとに summarizeSettlementBatch(batch, 全明細行, accounts) を呼んだ場合と同じ。スキーマは変えない。
 * DB非依存の純粋関数。
 */
export function summarizeSettlementBatches(
  batches: readonly SettlementBatch[],
  lines: readonly JournalLine[],
  accounts: readonly Account[],
): SettlementBatchSummary[] {
  const linesByBatch = new Map<number, JournalLine[]>()
  for (const line of lines) {
    if (line.settlementBatchId === null) continue
    const group = linesByBatch.get(line.settlementBatchId)
    if (group === undefined) linesByBatch.set(line.settlementBatchId, [line])
    else group.push(line)
  }
  return batches.map((batch) => summarizeSettlementBatch(batch, linesByBatch.get(batch.id) ?? [], accounts))
}
