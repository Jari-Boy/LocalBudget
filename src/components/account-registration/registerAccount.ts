import type { Account, CreateAccountInput } from '../../domain/account/Account'
import type { AccountBalanceRecord, CreateAccountBalanceRecordInput } from '../../domain/reconciliation/AccountBalanceRecord'

/** 「最初の残高の記録」(日付と金額、計画Issue #205)。日付の終わり時点の正しい残高 */
export interface FirstBalance {
  /** YYYY-MM-DD */
  date: string
  balance: number
}

export interface RegisterAccountInput {
  /** 資産・負債のいずれか(計画Issue #102、統合フローの入口で決定される) */
  category: 'asset' | 'liability'
  /**
   * 照合可否。「外部明細(CSV)の有無」×「残高情報の有無」という2軸の設問
   * (reconciliationQuestion.ts、docs/domain/accounts.md 4.2節)から呼び出し側が計算して渡す。
   */
  isReconcilable: boolean
  /**
   * 「外部明細(CSV)はありますか?」の回答(計画Issue #189)。isReconcilableはfalseの1値に
   * 「外部明細あり・残高なし」と「外部明細なし」が畳み込まれるため、回答そのものを保存する。
   * 省略時は照合可否から決まる(照合する科目は外部明細あり)
   */
  hasExternalStatement?: boolean
  name: string
  householdMemberId: number | null
  /** 所属グループ(計画Issue #154)。未指定・nullならグループなしで登録する */
  accountGroupId?: number | null
  /**
   * 最初の残高の記録(計画Issue #205、旧「初期残高」の入力の置き換え)。取引後残高のあるCSVの科目
   * (isReconcilable = true)は最初の明細から基準点が決まるため、渡されても記録しない
   */
  firstBalance?: FirstBalance | null
}

/**
 * Repository呼び出しをsql.js直接呼び出し(同期)・Web Worker越しのComlink RPC(非同期)の
 * どちらからでも受け取れるようにするための構造的型。呼び出し元の型(AccountRepositoryまたは
 * Comlink.Remote<AccountRepository>)はどちらもこの型を満たす(docs/architecture.md 5章)。
 */
export interface AccountCreator {
  create(input: CreateAccountInput): Account | Promise<Account>
}

export interface BalanceRecordCreator {
  create(input: CreateAccountBalanceRecordInput): AccountBalanceRecord | Promise<AccountBalanceRecord>
}

/**
 * 資産・負債の統合登録フローの確定処理(docs/domain/accounts.md 4章、計画Issue #102・#205)。
 * 資産または負債科目を1件作成し、最初の残高(日付+金額)が入力されていれば残高の記録として保存する。
 * 記録の保存と同じトランザクションで、Worker側が純資産「初期残高」を相手科目とする元手の自動調整仕訳を
 * 入れる(docs/domain/reconciliation.md 1.6)。ユーザーには「区分」「純資産」等の簿記用語を見せない。
 * 0以上の有限の数値だけを残高として扱い、それ以外(負数・NaN・Infinity)は「最初の残高なし」とする。
 * balanceRecordRepositoryがnullの使い方(残高の記録に対応しない画面)では科目だけを作る。
 */
export async function registerAccount(
  accountRepository: AccountCreator,
  balanceRecordRepository: BalanceRecordCreator | null,
  input: RegisterAccountInput,
): Promise<Account> {
  const account = await accountRepository.create({
    category: input.category,
    name: input.name,
    isReconcilable: input.isReconcilable,
    hasExternalStatement: input.hasExternalStatement,
    householdMemberId: input.householdMemberId,
    accountGroupId: input.accountGroupId ?? null,
  })

  const first = input.firstBalance
  const recordable =
    balanceRecordRepository !== null &&
    !input.isReconcilable &&
    first !== null &&
    first !== undefined &&
    first.date !== '' &&
    Number.isFinite(first.balance) &&
    first.balance >= 0
  if (recordable) {
    await balanceRecordRepository.create({ accountId: account.id, recordDate: first.date, balance: first.balance })
  }
  return account
}
