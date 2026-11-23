import type { SettlementBatchSummary } from './summarizeSettlementBatch'

/**
 * 精算バッチのクローズの状態の判定(計画Issue #249)。「未精算/精算済み」の区別は、利用者が決めるクローズ
 * (settlement_batches.is_active)で行い、残高から計算した「残高が0かどうか」(summary.isSettled)は
 * 保存しない。この2つが食い違う状態を、次の2つで見つける。DB非依存の純粋関数。
 */

/** クローズされていないのに、明細があって残高が0のバッチ。「クローズしますか?」と促す対象 */
export function isWaitingToClose(summary: SettlementBatchSummary): boolean {
  return summary.batch.isActive && summary.hasLines && summary.isSettled
}

/** クローズ済みなのに、残高が残っているバッチ(クローズ後に仕訳が編集された場合など)。警告の対象 */
export function isClosedWithBalance(summary: SettlementBatchSummary): boolean {
  return !summary.batch.isActive && summary.hasLines && !summary.isSettled
}

/** クローズ済みなのに残高があるバッチの数。精算タブの赤丸に出す */
export function countClosedWithBalance(summaries: readonly SettlementBatchSummary[]): number {
  return summaries.filter(isClosedWithBalance).length
}

/** 残高ありのバッチを先頭に出し、それ以外は元の並び順を保つ(精算済みの一覧の並び) */
export function sortClosedWithBalanceFirst(summaries: readonly SettlementBatchSummary[]): SettlementBatchSummary[] {
  return [...summaries.filter(isClosedWithBalance), ...summaries.filter((s) => !isClosedWithBalance(s))]
}
