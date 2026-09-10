export interface AccountGroup {
  id: number
  name: string
  parentGroupId: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAccountGroupInput {
  name: string
  parentGroupId?: number | null
}

export interface UpdateAccountGroupInput {
  name?: string
  parentGroupId?: number | null
}
