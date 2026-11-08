import type { AccountCategory } from '../account/Account'

/**
 * 精算バッチのタグ(journal_lines.settlement_batch_id)を設定できる明細行の科目かどうかを判定する
 * (計画Issue #144、#167で対象を絞り込み)。タグの対象は割勘の一時勘定、すなわちseedAdvanceAccountsが
 * 投入するシステム管理の立替金(資産)・未払金(負債)に限る(docs/domain/settlement.md 1.7)。
 * システム管理の資産・負債科目はこの2つだけである(初期残高は純資産)。精算画面が残高を見るのも
 * この2科目だけのため、他の科目に付けたタグはどこにも表示されない。UI(選択肢の出し分け)と
 * Repository(書き込み時検証)の両方でこの判定を共有する。
 */
export function isSettlementBatchTaggableAccount(account: {
  category: AccountCategory
  isSystemManaged: boolean
}): boolean {
  return (account.category === 'asset' || account.category === 'liability') && account.isSystemManaged
}
