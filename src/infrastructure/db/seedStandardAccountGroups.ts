import type { Database } from 'sql.js'
import type { AccountGroupCategory } from '../../domain/account-group/AccountGroup'
import seedMarkersSql from '../../../docs/schema/seed_markers.sql?raw'
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

/** seed_markersに残す印の名前 */
export const STANDARD_ACCOUNT_GROUPS_MARKER = 'standard_account_groups'

/**
 * 標準グループをWorker起動時に投入する(計画Issue #154)。投入するかどうかの判定は、そのDBで
 * 一度だけ行い、判定したら印(seed_markers)を残して、2回目以降は何もしない。利用者が標準グループを
 * 削除・改名した構成を、再起動のたびに復活させないため(「グループが0件なら投入」だけの判定では、
 * 全部削除した後の再起動で復活してしまう)。
 * 初回の判定: グループが1件も無く、利用者が登録した資産・負債の科目も無い新規DBにだけ投入する。
 * 既存DBには投入せず(既存の科目の所属も変えない)、投入しなかった場合も印を残すので、後から
 * 科目やグループがすべて無くなっても投入しない。システム管理の科目と収益・費用の科目は判定に
 * 影響しない。
 */
export function seedStandardAccountGroups(db: Database): void {
  db.run(seedMarkersSql)
  const [marked] = db.exec('SELECT 1 FROM seed_markers WHERE name = ?', [STANDARD_ACCOUNT_GROUPS_MARKER])
  if (marked) return

  const groups = new SqlJsAccountGroupRepository(db)
  const hasUserBalanceSheetAccount = new SqlJsAccountRepository(db)
    .findAll()
    .some(
      (account) =>
        !account.isSystemManaged && (account.category === 'asset' || account.category === 'liability'),
    )
  if (groups.findAll().length === 0 && !hasUserBalanceSheetAccount) {
    for (const { category, name } of STANDARD_ACCOUNT_GROUPS) {
      groups.create({ name, category })
    }
  }

  db.run('INSERT INTO seed_markers (name) VALUES (?)', [STANDARD_ACCOUNT_GROUPS_MARKER])
}
