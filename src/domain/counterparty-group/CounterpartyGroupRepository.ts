import type {
  CounterpartyGroup,
  CreateCounterpartyGroupInput,
  UpdateCounterpartyGroupInput,
} from './CounterpartyGroup'

/**
 * 取引先グループ(counterparty_groups)の永続化を担うRepositoryのポート(インターフェース)。
 * 子グループ・所属取引先が存在するグループの物理削除禁止・グループ名のユニーク制約は
 * DDL側(docs/schema/counterparties.sql)で強制され、実装(インフラ層)は制約違反時の例外を
 * そのまま伝播させる。親グループ変更時の循環参照検証はisDescendantGroup(ドメイン層の
 * 純粋関数)を用いて実装側で行う。
 */
export interface CounterpartyGroupRepository {
  create(input: CreateCounterpartyGroupInput): CounterpartyGroup
  findById(id: number): CounterpartyGroup | null
  findAll(): CounterpartyGroup[]
  update(id: number, input: UpdateCounterpartyGroupInput): CounterpartyGroup
  delete(id: number): void
  deactivate(id: number): CounterpartyGroup
}
