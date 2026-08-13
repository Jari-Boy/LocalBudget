export interface HouseholdMember {
  id: number
  name: string
  isGroup: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateHouseholdMemberInput {
  name: string
  isGroup?: boolean
}

export interface UpdateHouseholdMemberInput {
  name?: string
  /**
   * 通常は指定不要(nameのみ変更する用途を想定)。UIが作成後のisGroup変更を
   * 試みた際にDDL側のprevent_is_group_changeトリガー(household-members.md 1.5節)
   * によるエラーを発生させる経路としてのみ指定される想定。
   */
  isGroup?: boolean
}
