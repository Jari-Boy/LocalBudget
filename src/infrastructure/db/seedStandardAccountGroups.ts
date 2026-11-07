import type { Database } from 'sql.js'
import type { AccountGroupCategory } from '../../domain/account-group/AccountGroup'
import { SqlJsAccountGroupRepository } from './SqlJsAccountGroupRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/**
 * 口座・カードの登録時に所属グループとして初期選択する標準グループ(計画Issue #154)。
 * keyは登録フォームが初期選択するグループを引くための識別子で、DBには保存しない
 * (投入後は通常のグループなので、改名・移動・削除は自由。名前で引けなくなった場合は
 * 初期選択なしで登録する)。
 */
export const STANDARD_ACCOUNT_GROUPS: ReadonlyArray<{
  key: 'bank' | 'cash' | 'creditCard'
  category: AccountGroupCategory
  name: string
}> = [
  { key: 'bank', category: 'asset', name: '普通預金' },
  { key: 'cash', category: 'asset', name: '現金・電子マネー' },
  { key: 'creditCard', category: 'liability', name: 'クレジットカード' },
]

/**
 * 標準グループをWorker起動時に投入する(計画Issue #154)。グループが1件も無く、利用者が
 * 登録した資産・負債の科目も無い新規DBにだけ投入する。既存DBへは投入しない: 利用者が
 * 意図的に削除・改名した構成を復活させず、既存の科目の所属も変えないため。
 * システム管理の科目(立替金・未払金等)と収益・費用の科目は新規判定に影響しない。
 * 判定が「グループ0件」なので、再実行しても重複しない。
 */
export function seedStandardAccountGroups(db: Database): void {
  const groups = new SqlJsAccountGroupRepository(db)
  if (groups.findAll().length > 0) return

  const hasUserBalanceSheetAccount = new SqlJsAccountRepository(db)
    .findAll()
    .some(
      (account) =>
        !account.isSystemManaged && (account.category === 'asset' || account.category === 'liability'),
    )
  if (hasUserBalanceSheetAccount) return

  for (const { category, name } of STANDARD_ACCOUNT_GROUPS) {
    groups.create({ name, category })
  }
}
