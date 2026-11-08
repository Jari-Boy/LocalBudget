import type { AccountCategory } from '../../domain/account/Account'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'

/**
 * 外部明細取込の対象科目として選択肢に出してよいかどうかを判定する
 * (docs/domain/statement-import.md 1.5手順1、対象科目はassetの口座またはliabilityの
 * クレカ専用未払金、docs/domain/accounts.md 5章参照)。isSystemManagedな科目
 * (初期残高科目・残高調整科目等)は、journalEntryFormLine.isManualEntryEligibleAccountと
 * 同じ理由でUI側の選択肢から除外する(この制約はRepository層・DDL側のいずれにも存在せず、
 * UI側の絞り込みが事実上唯一の防御手段)。
 */
export function isStatementImportEligibleAccount(account: {
  category: AccountCategory
  isActive: boolean
  isSystemManaged: boolean
}): boolean {
  const isAssetOrLiability = account.category === 'asset' || account.category === 'liability'
  return isAssetOrLiability && account.isActive && !account.isSystemManaged
}

/**
 * 明細取込画面で相手勘定科目として選択してよいかどうかを判定する。
 * マニュアル入力(isManualEntryEligibleAccount)と異なり、is_reconcilable = trueの科目
 * (銀行口座等)も候補に含める。docs/domain/reconciliation.md 1.2の直接記帳制限ホワイトリストに
 * external_importが含まれているため、CSV取込由来の仕訳では口座間振替のようにis_reconcilable
 * = true科目同士を相手科目として使うことが許可されている。システム管理の科目(初期残高・残高調整等)は
 * 除くが、割勘の一時勘定である立替金(資産)・未払金(負債)だけは、精算バッチを付けて取り込めるように
 * 候補に含める(計画Issue #151)。
 */
export function isStatementImportCounterAccountEligible(account: {
  category: AccountCategory
  isReconcilable: boolean | null
  isSystemManaged: boolean
}): boolean {
  return !account.isSystemManaged || isSettlementBatchTaggableAccount(account)
}
