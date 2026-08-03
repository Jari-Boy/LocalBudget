import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'

export interface RegisterCreditCardInput {
  name: string
  householdMemberId: number | null
}

/**
 * クレジットカード登録ウィザードの確定処理(docs/domain/accounts.md 5章)。
 * category = 'liability'・is_reconcilable = falseで固定した負債科目を1件作成する。
 * 口座登録(4章)と異なり種類選択・初期残高入力のステップは存在しない(5.1節)。
 */
export function registerCreditCard(
  accountRepository: AccountRepository,
  input: RegisterCreditCardInput,
): Account {
  return accountRepository.create({
    category: 'liability',
    name: input.name,
    isReconcilable: false,
    householdMemberId: input.householdMemberId,
  })
}
