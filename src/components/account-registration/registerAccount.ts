import type { Account, CreateAccountInput } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import { determineIsReconcilable, type AccountKind } from './accountKind'

export interface InitialBalanceLine {
  /**
   * この金額をjournal_lines.householdMemberIdに反映する世帯メンバー。nullの場合は
   * 明細に明示的な値を設定せず、口座側の名義(household_member_id)継承ルール
   * (docs/domain/household-members.md 1.2節)に委ねる。通常はnull(単一の初期残高)だが、
   * 現金(kind = cash)で世帯メンバーが複数登録されている場合のみ、世帯メンバーごとに
   * 別々の行として複数渡される(計画Issue #90、世帯メンバーごとの初期残高入力)。
   */
  householdMemberId: number | null
  /** 未入力の場合はnull(docs/domain/accounts.md 4.1節、初期残高入力は任意) */
  amount: number | null
}

export interface RegisterAccountInput {
  kind: AccountKind
  name: string
  householdMemberId: number | null
  /**
   * 初期残高の内訳。通常は要素1件(単一の初期残高)だが、現金で世帯メンバーが
   * 複数登録されている場合は世帯メンバーごとに複数件になりうる(計画Issue #90)。
   */
  initialBalanceLines: InitialBalanceLine[]
  /** 初期残高がある場合の初期仕訳の日付(YYYY-MM-DD) */
  entryDate: string
  /**
   * 初期残高がある場合に作成される初期仕訳の起票者(CreateJournalEntryInput.householdMemberId、
   * 計画Issue #88)。口座自体の名義(householdMemberId、null許容)とは別概念であり、解決
   * (口座の名義があればそれを使う、無ければ既定メンバーにフォールバックする等)は呼び出し側
   * (AccountRegistrationWizard)の責務とする。
   */
  journalEntryHouseholdMemberId: number
}

/**
 * 初期残高行のうち、実際に金額が入力された(0以下・NaN・Infinityでない)行のみを残す。
 * journal_lines.amountはCHECK (amount > 0)制約を持つ(docs/schema/journal.sql)ため、
 * 0・負数・NaN・Infinityの行は「初期残高なし」として扱う。`amount <= 0`だけではNaNが
 * 素通りする(`NaN <= 0`は常にfalse)ため、Number.isFinite()で有限の数値であることも
 * 合わせて検証する。
 */
function selectValidInitialBalanceLines(
  lines: InitialBalanceLine[],
): Array<{ householdMemberId: number | null; amount: number }> {
  return lines.filter(
    (line): line is { householdMemberId: number | null; amount: number } =>
      line.amount !== null && Number.isFinite(line.amount) && line.amount > 0,
  )
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

  const validLines = selectValidInitialBalanceLines(input.initialBalanceLines)
  if (validLines.length === 0) {
    return account
  }

  const total = validLines.reduce((sum, line) => sum + line.amount, 0)

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
    householdMemberId: input.journalEntryHouseholdMemberId,
    lines: [
      ...validLines.map((line) => ({
        accountId: account.id,
        side: 'debit' as const,
        amount: line.amount,
        householdMemberId: line.householdMemberId,
      })),
      { accountId: initialBalanceAccount.id, side: 'credit', amount: total },
    ],
  })

  return account
}
