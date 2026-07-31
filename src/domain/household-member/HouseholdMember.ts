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
}
