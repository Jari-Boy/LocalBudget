import type { AccountGroup, CreateAccountGroupInput, UpdateAccountGroupInput } from './AccountGroup'

/**
 * 勘定科目グループ(account_groups)の永続化を担うRepositoryのポート(インターフェース)。
 * 子グループ・所属科目が存在するグループの物理削除禁止トリガー・グループ名の
 * ユニーク制約等のドメインルールはDDL側(docs/schema/accounts.sql)で強制されるため、
 * 実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる。
 * 親グループ変更時の循環参照検証はisDescendantGroup(ドメイン層の純粋関数)を用いて
 * 実装(インフラ層)側で行う(docs/domain/accounts.md 3.3節参照)。
 */
export interface AccountGroupRepository {
  create(input: CreateAccountGroupInput): AccountGroup
  findById(id: number): AccountGroup | null
  findAll(): AccountGroup[]
  update(id: number, input: UpdateAccountGroupInput): AccountGroup
  delete(id: number): void
  deactivate(id: number): AccountGroup
}
