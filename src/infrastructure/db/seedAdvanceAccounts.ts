import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/** e2eテスト(worker-rpc.spec.ts等)がWorker起動直後の科目一覧を検証する際にも再利用する */
export const ADVANCE_ASSET_ACCOUNT_NAME = '立替金'
/**
 * 負債側のみ資産側と異なる名前にする(計画Issue #139)。精算画面(SettlementScreen)の
 * 「科目」選択が「立替金(資産)」「未払金(負債)」という表示ラベルを使っており、裏付けとなる
 * 科目の実名も同じ言葉で区別できる方がわかりやすいという、実機レビューでのユーザー指摘への
 * 対応(詳細はdocs/decisions.md参照)。計画Issue #40時点では資産・負債とも同名の「立替金」
 * だったが、これを機に分離した。
 */
export const ADVANCE_LIABILITY_ACCOUNT_NAME = '未払金'

/**
 * 割勘の一時勘定(立替金/未払金)科目を自動投入する(docs/domain/expense-splitting.md 1.2節、
 * 計画Issue #40の人間レビューでの追加指摘、計画Issue #139で資産側・負債側の科目名を分離)。
 * 「科目自体は割勘のたびに新規作成しない。恒久的な汎用科目として1組だけ用意し、以降の
 * すべての割勘で使い回す」という方針を実現するため、asset・liability区分それぞれについて、
 * is_system_managed = trueの科目が1件も存在しなければ、資産側は「立替金」・負債側は
 * 「未払金」を1件投入する(区分ごとに独立して冪等に判定する、seedDefaultAccountsと同じ
 * 考え方)。判定をis_system_managedの有無に絞ることで、ユーザーが作成した無関係な資産・負債
 * 科目(現金・クレジットカード等)がいくつあっても投入をスキップしない。is_system_managed =
 * trueで作成することで、DBスキーマのトリガー(docs/schema/accounts.sql)により削除・区分
 * 変更・is_reconcilable変更を防ぎつつ、科目一覧画面(AccountListScreen)・手動仕訳フォーム
 * (JournalEntryForm)の選択肢からは除外され、割勘/精算画面だけが解決して使う恒久的な
 * 一時勘定として機能する。
 */
export function seedAdvanceAccounts(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const accounts = repository.findAll()

  seedIfMissing(repository, accounts, 'asset', ADVANCE_ASSET_ACCOUNT_NAME)
  seedIfMissing(repository, accounts, 'liability', ADVANCE_LIABILITY_ACCOUNT_NAME)
}

/**
 * asset/liabilityはequity(prevent_user_created_equity_accountトリガー参照)と異なり
 * ユーザーが自由に科目を作成できる区分のため、is_system_managedの科目が0件でも「立替金」
 * という名前の通常科目(is_system_managed = false)を既にユーザーが作成済みの状況が
 * ありうる(本Issueの旧UIでの手動作成やバックアップ復元経由、Review Attempt 5で
 * evaluatorが指摘・再現)。その場合はcategory・nameのUNIQUE制約(docs/schema/accounts.sql)
 * に反して例外が投げられるが、Worker起動処理(db.worker.ts)を丸ごとクラッシュさせず、
 * その区分の投入だけを諦めて起動を継続する(既存の科目を書き換えたり奪ったりはしない)。
 * この場合、割勘/精算画面はその区分の立替金科目を解決できず利用できない状態になるが、
 * アプリ全体が使用不能になるより望ましい(Review Attempt 5 MEDIUM指摘対応)。
 */
function seedIfMissing(
  repository: SqlJsAccountRepository,
  existingAccounts: ReturnType<SqlJsAccountRepository['findAll']>,
  category: Extract<AccountCategory, 'asset' | 'liability'>,
  name: string,
): void {
  if (existingAccounts.some((account) => account.category === category && account.isSystemManaged)) return

  try {
    repository.create({
      category,
      name,
      isReconcilable: false,
      isSystemManaged: true,
    })
  } catch (error) {
    console.error(
      `割勘の一時勘定(${name}、${category})の自動投入に失敗しました。同名の科目が既に存在する可能性があります`,
      error,
    )
  }
}
