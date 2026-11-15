import type {
  AccountBalanceRecord,
  CreateAccountBalanceRecordInput,
  UpdateAccountBalanceRecordInput,
} from './AccountBalanceRecord'

/**
 * 手で記録した残高(account_balance_records)のRepositoryのポート(計画Issue #205)。
 * 追加・編集・削除のたびに、実装は同じトランザクションで科目の自動調整仕訳を計算し直す。
 * 同じ科目・同じ日は1件だけで、重複はDDLの一意制約で拒否される。
 */
export interface AccountBalanceRecordRepository {
  create(input: CreateAccountBalanceRecordInput): AccountBalanceRecord
  update(id: number, input: UpdateAccountBalanceRecordInput): AccountBalanceRecord
  delete(id: number): void
  findByAccount(accountId: number): AccountBalanceRecord[]
}
