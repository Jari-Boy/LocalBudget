import type { Account } from '../../domain/account/Account'
import type { AccountCreator } from './registerAccount'

export interface RegisterCreditCardInput {
  name: string
  householdMemberId: number | null
}

/**
 * クレジットカード登録ウィザードの確定処理(docs/domain/accounts.md 5章)。
 * category = 'liability'・is_reconcilable = falseで固定した負債科目を1件作成する。
 * 口座登録(4章)と異なり種類選択・初期残高入力のステップは存在しない(5.1節)。
 * AccountCreator(registerAccount.ts参照)によりsql.js直接呼び出し・RPC越しの
 * どちらの呼び出し方でも使える。
 */
export async function registerCreditCard(
  accountRepository: AccountCreator,
  input: RegisterCreditCardInput,
): Promise<Account> {
  return accountRepository.create({
    category: 'liability',
    name: input.name,
    isReconcilable: false,
    householdMemberId: input.householdMemberId,
  })
}
