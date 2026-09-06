import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/** e2eテスト(worker-rpc.spec.ts等)がWorker起動直後の科目一覧を検証する際にも再利用する */
export const ADVANCE_ACCOUNT_NAME = '立替金'

/**
 * 割勘の一時勘定(立替金)科目を自動投入する(docs/domain/expense-splitting.md 1.2節、
 * 計画Issue #40の人間レビューでの追加指摘)。「科目自体は割勘のたびに新規作成しない。
 * 恒久的な汎用科目として1組だけ用意し、以降のすべての割勘で使い回す」という方針を
 * 実現するため、asset・liability区分それぞれについて、is_system_managed = trueの科目が
 * 1件も存在しなければ「立替金」を1件投入する(区分ごとに独立して冪等に判定する、
 * seedDefaultAccountsと同じ考え方)。判定をis_system_managedの有無に絞ることで、
 * ユーザーが作成した無関係な資産・負債科目(現金・クレジットカード等)がいくつあっても
 * 投入をスキップしない。is_system_managed = trueで作成することで、DBスキーマの
 * トリガー(docs/schema/accounts.sql)により削除・区分変更・is_reconcilable変更を防ぎつつ、
 * 科目一覧画面(AccountListScreen)・手動仕訳フォーム(JournalEntryForm)の選択肢からは
 * 除外され、割勘/精算画面だけが解決して使う恒久的な一時勘定として機能する。
 */
export function seedAdvanceAccounts(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const accounts = repository.findAll()

  seedIfMissing(repository, accounts, 'asset')
  seedIfMissing(repository, accounts, 'liability')
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
): void {
  if (existingAccounts.some((account) => account.category === category && account.isSystemManaged)) return

  try {
    repository.create({
      category,
      name: ADVANCE_ACCOUNT_NAME,
      isReconcilable: false,
      isSystemManaged: true,
    })
  } catch (error) {
    console.error(
      `割勘の一時勘定(立替金、${category})の自動投入に失敗しました。同名の科目が既に存在する可能性があります`,
      error,
    )
  }
}
