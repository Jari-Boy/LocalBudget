import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { DEFAULT_EXPENSE_ACCOUNT_NAMES, DEFAULT_REVENUE_ACCOUNT_NAMES } from './defaultAccountSeedData'

/**
 * revenue・expense区分の科目がそれぞれ1件も登録されていない場合に、標準的な収益・費用科目
 * (defaultAccountSeedData.ts、docs/domain/accounts.md 1.2節、計画Issue #96)を自動投入する。
 * 区分ごとに独立して0件かどうかを判定する(seedDefaultHouseholdMemberと同じ「0件なら投入」
 * という考え方を区分単位に適用したもの。既存の1件でも部分投入は行わない意図的な割り切り)。
 * 投入する科目はすべてisSystemManaged = false・accountGroupId = null・householdMemberId = null
 * とし、is_system_managed = trueの「費用・残高調整」科目やasset/liability/equity区分の科目は
 * このseed関数の対象外(別の未実装機能である残高調整UI側の責務)。Worker起動のたびに呼ばれても
 * 冪等であり、db.worker.tsからrunMigrations直後に呼び出す。
 */
export function seedDefaultAccounts(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const accounts = repository.findAll()

  seedCategoryIfEmpty(repository, accounts, 'revenue', DEFAULT_REVENUE_ACCOUNT_NAMES)
  seedCategoryIfEmpty(repository, accounts, 'expense', DEFAULT_EXPENSE_ACCOUNT_NAMES)
}

function seedCategoryIfEmpty(
  repository: SqlJsAccountRepository,
  existingAccounts: ReturnType<SqlJsAccountRepository['findAll']>,
  category: AccountCategory,
  names: readonly string[],
): void {
  if (existingAccounts.some((account) => account.category === category)) return

  for (const name of names) {
    repository.create({ category, name, isReconcilable: null })
  }
}
