import type { Account, CreateAccountInput } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
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
 * Repository呼び出しをsql.js直接呼び出し(同期)・Web Worker越しのComlink RPC(非同期)の
 * どちらからでも受け取れるようにするための構造的型。呼び出し元の型(AccountRepositoryまたは
 * Comlink.Remote<AccountRepository>)はどちらもこの型を満たす(docs/architecture.md 5章)。
 */
export interface AccountCreator {
  create(input: CreateAccountInput): Account | Promise<Account>
}

export interface JournalEntryCreator {
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

/**
 * 口座登録ウィザードの確定処理(docs/domain/accounts.md 4章)。
 * 資産科目を1件作成し、初期残高が入力されていれば口座専用の初期残高科目
 * (equity区分・is_system_managed = true)と初期仕訳(source_type = 'initial_balance')を
 * 自動生成する(4.3節)。ユーザーには「区分」「純資産」等の簿記用語を見せない。
 */
export async function registerAccount(
  accountRepository: AccountCreator,
  journalEntryRepository: JournalEntryCreator,
  input: RegisterAccountInput,
): Promise<Account> {
  const account = await accountRepository.create({
    category: 'asset',
    name: input.name,
    isReconcilable: determineIsReconcilable(input.kind),
    householdMemberId: input.householdMemberId,
  })

  if (input.initialBalance === null) {
    return account
  }

  const initialBalanceAccount = await accountRepository.create({
    category: 'equity',
    name: `初期残高(${input.name})`,
    isReconcilable: null,
    isSystemManaged: true,
    initialBalanceForAccountId: account.id,
  })

  await journalEntryRepository.create({
    entryDate: input.entryDate,
    sourceType: 'initial_balance',
    lines: [
      { accountId: account.id, side: 'debit', amount: input.initialBalance },
      { accountId: initialBalanceAccount.id, side: 'credit', amount: input.initialBalance },
    ],
  })

  return account
}
