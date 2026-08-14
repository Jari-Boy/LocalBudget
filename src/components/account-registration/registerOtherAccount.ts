import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountCreator } from './registerAccount'
import { reconciliationAnswerToIsReconcilable, type ReconciliationAnswer } from './reconciliationQuestion'

export interface RegisterOtherAccountInput {
  category: AccountCategory
  name: string
  householdMemberId: number | null
  /** 資産・負債の場合のみ必須。収益・費用ではis_reconcilableが常にnullのため省略する */
  reconciliationAnswer?: ReconciliationAnswer
}

/**
 * 「その他の科目を追加する」フォーム(計画Issue #95、docs/domain/accounts.md 1.2節の
 * 「未収金」、収益・費用科目、将来のローン・立替金等を想定)の確定処理。
 * 資産・負債を選んだ場合のみreconciliationQuestion.tsの設問回答からis_reconcilableを
 * 決定し、収益・費用の場合は常にnullにする(DDLのCHECK制約と一致させる)。
 */
export async function registerOtherAccount(
  accountRepository: AccountCreator,
  input: RegisterOtherAccountInput,
): Promise<Account> {
  const isReconcilable =
    input.category === 'asset' || input.category === 'liability'
      ? reconciliationAnswerToIsReconcilable(input.reconciliationAnswer as ReconciliationAnswer)
      : null

  return accountRepository.create({
    category: input.category,
    name: input.name,
    isReconcilable,
    householdMemberId: input.householdMemberId,
  })
}
