import type {
  CreateHouseholdMemberInput,
  HouseholdMember,
  UpdateHouseholdMemberInput,
} from './HouseholdMember'

/**
 * 世帯メンバー(household_members)の永続化を担うRepositoryのポート(インターフェース)。
 * is_groupの変更禁止・グループのネスト禁止・紐づく勘定科目/仕訳明細が存在するメンバーの
 * 物理削除禁止トリガー等のドメインルールはDDL側(docs/schema/household_members.sql)で
 * 強制されるため、実装(インフラ層)は制約違反時の例外をそのまま呼び出し元に伝播させる
 * (docs/domain/household-members.md参照)。
 */
export interface HouseholdMemberRepository {
  create(input: CreateHouseholdMemberInput): HouseholdMember
  findById(id: number): HouseholdMember | null
  findAll(): HouseholdMember[]
  update(id: number, input: UpdateHouseholdMemberInput): HouseholdMember
  delete(id: number): void
  deactivate(id: number): HouseholdMember
  addGroupMember(groupId: number, memberId: number): void
  removeGroupMember(groupId: number, memberId: number): void
  findGroupMembers(groupId: number): HouseholdMember[]
}
