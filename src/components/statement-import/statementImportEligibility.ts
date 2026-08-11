import type { AccountCategory } from '../../domain/account/Account'

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
 * CSV取込レビュー画面で相手勘定科目として選択してよいかどうかを判定する。
 * マニュアル入力(isManualEntryEligibleAccount)と異なり、is_reconcilable = trueの科目
 * (銀行口座等)も候補に含める。docs/domain/reconciliation.md 1.2の直接記帳制限ホワイトリストに
 * external_importが含まれているため、CSV取込由来の仕訳では口座間振替のようにis_reconcilable
 * = true科目同士を相手科目として使うことが許可されている。isSystemManagedな科目のみを除外する。
 */
export function isStatementImportCounterAccountEligible(account: { isSystemManaged: boolean }): boolean {
  return !account.isSystemManaged
}
