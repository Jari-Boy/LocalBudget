export interface Project {
  id: number
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
}

export interface UpdateProjectInput {
  name?: string
}
