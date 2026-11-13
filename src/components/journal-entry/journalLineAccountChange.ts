import type { Account } from '../../domain/account/Account'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { isCounterpartyEligibleCategory, type JournalEntryFormLine } from './journalEntryFormLine'
import { memberAfterAccountChange } from './journalEditorMember'

/**
 * 明細行の科目を変えたときの、行の更新(純粋関数)。詳細パネルの行編集(JournalLinesEditor)と、
 * 明細行単位の表のインライン編集(JournalLineTable、計画Issue #182)が同じ規則を使うために切り出した。
 * その科目では持てない取引先(費用・収益の科目だけ持てる)と精算バッチ(システム管理の立替金・未払金だけ
 * 持てる)の指定を外し、世帯メンバーは memberAfterAccountChange の規則(科目の既定 > 手で選んだ値 > 起票者)で決める。
 */
export function applyAccountChange(params: {
  line: JournalEntryFormLine
  accountId: number | null
  accountById: ReadonlyMap<number, Account>
  /** 起票者。行の世帯メンバーの既定値になる(未決定なら null) */
  bookkeeperId: number | null
}): JournalEntryFormLine {
  const { line, accountId, accountById, bookkeeperId } = params
  const account = accountId === null ? undefined : accountById.get(accountId)
  return {
    ...line,
    accountId,
    counterpartyId: account !== undefined && isCounterpartyEligibleCategory(account.category) ? line.counterpartyId : null,
    settlementBatchId: account !== undefined && isSettlementBatchTaggableAccount(account) ? line.settlementBatchId : null,
    householdMemberId: memberAfterAccountChange({
      line,
      newAccountDefault: account?.householdMemberId ?? null,
      previousAccountDefault: line.accountId === null ? null : (accountById.get(line.accountId)?.householdMemberId ?? null),
      entryMemberId: bookkeeperId,
    }),
  }
}
