import type { Account } from '../../domain/account/Account'
import type { AccountCreator } from './registerAccount'

export interface RegisterRevenueOrExpenseAccountInput {
  category: 'revenue' | 'expense'
  name: string
}

/**
 * 統合登録フロー・収益・費用サブフロー(docs/domain/accounts.md 4章、計画Issue #102)の
 * 確定処理。「カテゴリ(収益/費用)を選ぶ→科目名を入力する」の2ステップのみで完結し、
 * 名義選択・初期残高入力のステップは持たない。is_reconcilableは資産・負債科目とは異なり
 * 常にnull(DDLのCHECK制約と一致)、householdMemberIdも常にnullで登録する。
 */
export async function registerRevenueOrExpenseAccount(
  accountRepository: AccountCreator,
  input: RegisterRevenueOrExpenseAccountInput,
): Promise<Account> {
  return accountRepository.create({
    category: input.category,
    name: input.name,
    isReconcilable: null,
    householdMemberId: null,
  })
}
