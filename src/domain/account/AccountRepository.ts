import type { Account, CreateAccountInput, UpdateAccountInput } from './Account'

/**
 * 勘定科目(accounts)の永続化を担うRepositoryのポート(インターフェース)。
 * 区分の変更禁止・equity区分の作成制限・is_system_managed科目のライフサイクル制約等の
 * ドメインルールはDDL側のCHECK制約/トリガー(docs/schema/accounts.sql)で強制されるため、
 * 実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる
 * (docs/domain/accounts.md参照)。
 */
export interface AccountRepository {
  create(input: CreateAccountInput): Account
  findById(id: number): Account | null
  findAll(): Account[]
  update(id: number, input: UpdateAccountInput): Account
  delete(id: number): void
  deactivate(id: number): Account
}
