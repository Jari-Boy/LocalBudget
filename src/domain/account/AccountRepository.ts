import type { Account, CreateAccountInput, UpdateAccountInput, UpdateAccountOptions } from './Account'

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
  update(id: number, input: UpdateAccountInput, options?: UpdateAccountOptions): Account
  delete(id: number): void
  deactivate(id: number): Account
  activate(id: number): Account
  /**
   * 複数の科目(統合元)を1科目(統合先)に統合する(docs/domain/accounts.md 2.2、計画Issue #97)。
   * 統合元の`journal_lines.account_id`を統合先へ一括で付け替え(反対仕訳は作らない)、統合元ごとに
   * `account_merge_log`へ1行(名称のスナップショット・付け替え件数)を記録する。全体で1トランザクション。
   * 統合元は残る(仕訳は0件になるので、呼び出し側が削除または非アクティブ化できる)。
   * 統合できるのは、同じ区分・同じ照合可否の、システム管理でない科目同士で、統合先は有効な科目に限る。
   * 条件を満たさないときは例外を投げ、何も変更しない。
   */
  merge(targetId: number, sourceIds: number[]): void
}
