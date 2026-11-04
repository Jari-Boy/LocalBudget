import type { Database } from 'sql.js'
import type { AccountCategory } from '../../domain/account/Account'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/** 精算画面(計画Issue #139)が差額計上(資産側の過不足)に使う収益科目名 */
export const SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME = '雑収入'
/** 精算画面(計画Issue #139)が差額計上(負債側の過不足)に使う費用科目名 */
export const SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME = '雑損失'

/**
 * 精算画面(計画Issue #139)の「金額不一致時に差額を損益計上して精算完了する」操作のために、
 * 差額計上先の「雑収入」(revenue)・「雑損失」(expense)科目を自動投入する。
 * seedDefaultAccounts(区分に1件でも科目があれば投入をスキップする判定)とは異なり、
 * seedAdvanceAccountsと同じく科目名の有無で個別に判定する。revenue・expense区分には
 * 既にseedDefaultAccountsが投入した標準科目が存在している状況が通常であり、
 * 「区分が空かどうか」では「雑収入」「雑損失」を確実に投入できないため。
 * is_system_managed = falseの通常科目として投入し、ユーザーが自由に改名・削除できる
 * (削除された場合は次回のWorker起動時に本関数が再投入する)。Worker起動のたびに呼ばれても
 * 冪等であり、db.worker.tsからseedDefaultAccounts・seedAdvanceAccountsの後に呼び出す。
 */
export function seedSettlementAdjustmentAccounts(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const accounts = repository.findAll()

  seedIfMissingByName(repository, accounts, 'revenue', SETTLEMENT_ADJUSTMENT_GAIN_ACCOUNT_NAME)
  seedIfMissingByName(repository, accounts, 'expense', SETTLEMENT_ADJUSTMENT_LOSS_ACCOUNT_NAME)
}

function seedIfMissingByName(
  repository: SqlJsAccountRepository,
  existingAccounts: ReturnType<SqlJsAccountRepository['findAll']>,
  category: AccountCategory,
  name: string,
): void {
  if (existingAccounts.some((account) => account.name === name)) return

  repository.create({ category, name, isReconcilable: null })
}
