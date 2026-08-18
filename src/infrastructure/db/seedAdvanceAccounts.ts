import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

const ADVANCE_ACCOUNT_NAME = '立替金'

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

function seedIfMissing(
  repository: SqlJsAccountRepository,
  existingAccounts: ReturnType<SqlJsAccountRepository['findAll']>,
  category: Extract<AccountCategory, 'asset' | 'liability'>,
): void {
  if (existingAccounts.some((account) => account.category === category && account.isSystemManaged)) return

  repository.create({
    category,
    name: ADVANCE_ACCOUNT_NAME,
    isReconcilable: false,
    isSystemManaged: true,
  })
}
