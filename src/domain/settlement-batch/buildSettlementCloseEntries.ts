import type { Account } from '../account/Account'
import type { CreateJournalEntryInput } from '../journal/JournalEntry'
import { createLineHouseholdMemberResolver } from '../journal/resolveLineHouseholdMemberId'
import { buildSettlementJournalEntryInput } from '../settlement/buildSettlementJournalEntryInput'
import { resolveSettlementAdjustment } from '../settlement/resolveSettlementAdjustment'
import type { SettlementBatchSummary, SettlementDirection } from './summarizeSettlementBatch'

export interface BuildSettlementCloseEntriesParams {
  summary: SettlementBatchSummary
  accounts: readonly Pick<Account, 'id' | 'householdMemberId'>[]
  /** 雑収入の科目id */
  gainAccountId: number
  /** 雑損失の科目id */
  lossAccountId: number
  /** 振替仕訳の取引日(YYYY-MM-DD) */
  entryDate: string
  memo: string | null
}

/**
 * 精算バッチをクローズするとき、残っている残高を雑損失・雑収入へ振り替えて0にする仕訳を組み立てる
 * (計画Issue #249、docs/domain/settlement.md)。方向(未収金・未払金)と世帯メンバーごとに、残高が0でないものだけ
 * 1件ずつ作る(方向どうしは相殺しない)。仕訳の組み立てと損益の振り分けは、精算タブの差額計上と同じ
 * buildSettlementJournalEntryInput・resolveSettlementAdjustment を使う(選んだ仕訳の合計が0の精算として扱う)。
 * 未収金の放棄は雑損失、未払金の免除は雑収入になる。残高が負(相手へ返す側)のときは向きを逆にする。
 * 仕訳の起票者は、その残高を持つ世帯メンバー。DBアクセスなしの純粋関数。
 */
export function buildSettlementCloseEntries(params: BuildSettlementCloseEntriesParams): CreateJournalEntryInput[] {
  const { summary } = params
  const entries: CreateJournalEntryInput[] = []

  for (const direction of ['advance', 'payable'] as const satisfies readonly SettlementDirection[]) {
    const directionSummary = summary[direction]
    if (directionSummary === null) continue
    const baseCategory = direction === 'advance' ? 'asset' : 'liability'

    for (const { householdMemberId, balance } of directionSummary.breakdown) {
      if (householdMemberId === null || balance === 0) continue
      const reversed = balance < 0
      const category = reversed ? (baseCategory === 'asset' ? 'liability' : 'asset') : baseCategory
      // 選んだ仕訳の合計が0のときの差額(合計 - 残高)として、残高を丸ごと損益に振り替える
      const adjustment = resolveSettlementAdjustment(-Math.abs(balance), category)

      entries.push(
        buildSettlementJournalEntryInput({
          settlementBatchId: summary.batch.id,
          settlementAccountId: directionSummary.accountId,
          settlementAccountCategory: adjustment.effectiveCategory,
          counterAccountId: adjustment.isGain ? params.gainAccountId : params.lossAccountId,
          amount: adjustment.amount,
          settlementHouseholdMemberId: householdMemberId,
          entryHouseholdMemberId: householdMemberId,
          entryDate: params.entryDate,
          memo: params.memo,
          resolveLineHouseholdMemberId: createLineHouseholdMemberResolver(params.accounts, householdMemberId),
        }),
      )
    }
  }
  return entries
}
