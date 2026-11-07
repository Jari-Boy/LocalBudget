import type { AccountCategory } from '../account/Account'

/**
 * 精算バッチのタグ(journal_lines.settlement_batch_id)を設定できる明細行の科目かどうかを判定する
 * (計画Issue #144)。タグの対象は一時勘定、すなわちis_reconcilable = falseの資産・負債科目
 * (立替金・未払金・未収金等、docs/domain/settlement.md 1.4)に限る。口座科目(is_reconcilable
 * = true)や損益科目に付けても未精算残高の集計(calculateSettlementBatchBalance)に載らず、
 * 意味のないタグが残るだけになるため、UI(選択肢の出し分け)とRepository(書き込み時検証)の
 * 両方でこの判定を共有する。
 */
export function isSettlementBatchTaggableAccount(account: {
  category: AccountCategory
  isReconcilable: boolean | null
}): boolean {
  return (account.category === 'asset' || account.category === 'liability') && account.isReconcilable === false
}
