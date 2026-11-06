import type { Database } from 'sql.js'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'

/**
 * 初期仕訳(source_type = 'initial_balance')の相手科目となる、単一のシステム管理科目の名前
 * (計画Issue #143、docs/domain/accounts.md 4.3節)。registerAccountがこの名前で解決する。
 */
export const INITIAL_BALANCE_ACCOUNT_NAME = '初期残高'

/**
 * 初期仕訳の相手科目「初期残高」(equity・is_system_managed = true)をWorker起動時に1件だけ
 * 冪等に投入する(計画Issue #143)。従来は口座ごとに「初期残高(口座名)」科目を作っていたが、
 * 口座数だけ科目が増える・同名口座で重複エラーになる問題があったため単一科目へ統合した。
 * equity区分の科目はユーザーが作成できない(prevent_user_created_equity_accountトリガー)ため
 * 名前衝突は起きない。判定は区分とis_system_managedとnameの組で行い、科目名が変更されても
 * (システム管理科目はnameのみ変更可能)重複投入しないよう、equityのシステム管理科目が既に
 * あれば投入をスキップする。
 */
export function seedInitialBalanceAccount(db: Database): void {
  const repository = new SqlJsAccountRepository(db)
  const exists = repository
    .findAll()
    .some((account) => account.category === 'equity' && account.isSystemManaged)
  if (exists) return

  repository.create({
    category: 'equity',
    name: INITIAL_BALANCE_ACCOUNT_NAME,
    isReconcilable: null,
    isSystemManaged: true,
  })
}
