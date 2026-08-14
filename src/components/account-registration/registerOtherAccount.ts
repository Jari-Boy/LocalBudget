import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountCreator } from './registerAccount'

/**
 * 計画Issue #92時点の単一設問(reconciliationQuestion.tsの旧ReconciliationAnswer)の名残。
 * 計画Issue #102でreconciliationQuestion.tsは2軸設問に置き換えられたが、本フォーム
 * (OtherAccountCreationForm)自体が計画Issue #102で廃止される予定のため、共有型を
 * 追いかけて拡張はせず、この関数のスコープに閉じたローカル型として残す。
 */
export type LegacyReconciliationAnswer = 'matches_external_statement' | 'manual_only'

export interface RegisterOtherAccountInput {
  category: AccountCategory
  name: string
  householdMemberId: number | null
  /** 資産・負債の場合のみ必須。収益・費用ではis_reconcilableが常にnullのため省略する */
  reconciliationAnswer?: LegacyReconciliationAnswer
}

/**
 * 「その他の科目を追加する」フォーム(計画Issue #95、docs/domain/accounts.md 1.2節の
 * 「未収金」、収益・費用科目、将来のローン・立替金等を想定)の確定処理。
 * 資産・負債を選んだ場合のみreconciliationAnswerからis_reconcilableを決定し、
 * 収益・費用の場合は常にnullにする(DDLのCHECK制約と一致させる)。
 */
export async function registerOtherAccount(
  accountRepository: AccountCreator,
  input: RegisterOtherAccountInput,
): Promise<Account> {
  const isReconcilable =
    input.category === 'asset' || input.category === 'liability'
      ? input.reconciliationAnswer === 'matches_external_statement'
      : null

  return accountRepository.create({
    category: input.category,
    name: input.name,
    isReconcilable,
    householdMemberId: input.householdMemberId,
  })
}
