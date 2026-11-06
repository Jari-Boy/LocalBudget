import type { Account, CreateAccountInput } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'

export interface InitialBalanceLine {
  /**
   * この金額をjournal_lines.householdMemberIdに反映する世帯メンバー。nullの場合は
   * 明細に明示的な値を設定せず、口座側の名義(household_member_id)継承ルール
   * (docs/domain/household-members.md 1.2節)に委ねる。世帯メンバーごとに複数行を
   * 渡す設計(計画Issue #90、現金の世帯メンバーごとの初期残高入力)は計画Issue #102で
   * 統合フローに一本化された際に廃止されたため、現在の唯一の呼び出し元
   * (AccountRegistrationFlow)は常に要素1件(householdMemberId: null)の配列を渡す。
   */
  householdMemberId: number | null
  /** 未入力の場合はnull(docs/domain/accounts.md 4.1節、初期残高入力は任意) */
  amount: number | null
}

export interface RegisterAccountInput {
  /** 資産・負債のいずれか(計画Issue #102、統合フローの入口で決定される) */
  category: 'asset' | 'liability'
  /**
   * 照合可否。「外部明細(CSV)の有無」×「残高情報の有無」という2軸の設問
   * (reconciliationQuestion.ts、docs/domain/accounts.md 4.2節)から呼び出し側が計算して渡す。
   */
  isReconcilable: boolean
  name: string
  householdMemberId: number | null
  /** 初期残高の内訳(InitialBalanceLineのフィールドコメント参照) */
  initialBalanceLines: InitialBalanceLine[]
  /** 初期残高がある場合の初期仕訳の日付(YYYY-MM-DD) */
  entryDate: string
  /**
   * 初期残高がある場合に作成される初期仕訳の起票者(CreateJournalEntryInput.householdMemberId、
   * 計画Issue #88)。口座自体の名義(householdMemberId、null許容)とは別概念であり、解決
   * (口座の名義があればそれを使う、無ければ既定メンバーにフォールバックする等)は呼び出し側
   * (AccountRegistrationFlow)の責務とする。
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
  /** 初期残高の相手科目(単一のequityシステム管理科目)の解決に使う(計画Issue #143) */
  findAll(): Account[] | Promise<Account[]>
}

export interface JournalEntryCreator {
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

/**
 * 資産・負債の統合登録フローの確定処理(docs/domain/accounts.md 4章、計画Issue #102)。
 * 資産または負債科目を1件作成し、初期残高が入力されていれば単一のシステム管理科目
 * 「初期残高」(equity、seedInitialBalanceAccountがWorker起動時に投入、計画Issue #143)を
 * 相手科目とする初期仕訳(source_type = 'initial_balance')を自動生成する(4.3節)。
 * 記帳の向きは区分で変わる: 資産は「借方: 口座 / 貸方: 初期残高」、負債は
 * 「借方: 初期残高 / 貸方: 負債」。ユーザーには「区分」「純資産」等の簿記用語を見せない。
 * 相手科目が未投入の場合は、口座だけが残らないよう口座作成より前にエラーとする。
 */
export async function registerAccount(
  accountRepository: AccountCreator,
  journalEntryRepository: JournalEntryCreator,
  input: RegisterAccountInput,
): Promise<Account> {
  const validLines = selectValidInitialBalanceLines(input.initialBalanceLines)
  const initialBalanceAccount =
    validLines.length > 0 ? await findInitialBalanceAccount(accountRepository) : null

  const account = await accountRepository.create({
    category: input.category,
    name: input.name,
    isReconcilable: input.isReconcilable,
    householdMemberId: input.householdMemberId,
  })

  if (initialBalanceAccount === null) {
    return account
  }

  const total = validLines.reduce((sum, line) => sum + line.amount, 0)
  const accountSide = input.category === 'asset' ? 'debit' : 'credit'
  const counterSide = input.category === 'asset' ? 'credit' : 'debit'

  await journalEntryRepository.create({
    entryDate: input.entryDate,
    sourceType: 'initial_balance',
    householdMemberId: input.journalEntryHouseholdMemberId,
    lines: [
      ...validLines.map((line) => ({
        accountId: account.id,
        side: accountSide as 'debit' | 'credit',
        amount: line.amount,
        householdMemberId: line.householdMemberId,
      })),
      { accountId: initialBalanceAccount.id, side: counterSide, amount: total },
    ],
  })

  return account
}

async function findInitialBalanceAccount(accountRepository: AccountCreator): Promise<Account> {
  const accounts = await accountRepository.findAll()
  const found = accounts.find((account) => account.category === 'equity' && account.isSystemManaged)
  if (!found) {
    throw new Error('初期残高科目(equity・システム管理)が見つかりません。アプリを再起動してください')
  }
  return found
}
