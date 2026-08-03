import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { determineIsReconcilable, type AccountKind } from './accountKind'

export interface RegisterAccountInput {
  kind: AccountKind
  name: string
  householdMemberId: number | null
  /** 未入力の場合はnull(docs/domain/accounts.md 4.1節、初期残高入力は任意) */
  initialBalance: number | null
  /** 初期残高がある場合の初期仕訳の日付(YYYY-MM-DD) */
  entryDate: string
}

/**
 * 口座登録ウィザードの確定処理(docs/domain/accounts.md 4章)。
 * 資産科目を1件作成し、初期残高が入力されていれば口座専用の初期残高科目
 * (equity区分・is_system_managed = true)と初期仕訳(source_type = 'initial_balance')を
 * 自動生成する(4.3節)。ユーザーには「区分」「純資産」等の簿記用語を見せない。
 */
export function registerAccount(
  accountRepository: AccountRepository,
  journalEntryRepository: JournalEntryRepository,
  input: RegisterAccountInput,
): Account {
  const account = accountRepository.create({
    category: 'asset',
    name: input.name,
    isReconcilable: determineIsReconcilable(input.kind),
    householdMemberId: input.householdMemberId,
  })

  if (input.initialBalance === null) {
    return account
  }

  const initialBalanceAccount = accountRepository.create({
    category: 'equity',
    name: `初期残高(${input.name})`,
    isReconcilable: null,
    isSystemManaged: true,
    initialBalanceForAccountId: account.id,
  })

  journalEntryRepository.create({
    entryDate: input.entryDate,
    sourceType: 'initial_balance',
    lines: [
      { accountId: account.id, side: 'debit', amount: input.initialBalance },
      { accountId: initialBalanceAccount.id, side: 'credit', amount: input.initialBalance },
    ],
  })

  return account
}
