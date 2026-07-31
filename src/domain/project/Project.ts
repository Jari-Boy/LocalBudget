export type ProjectKind = 'settlement' | 'event'

export interface Project {
  id: number
  name: string
  kind: ProjectKind
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  kind?: ProjectKind
}

export interface UpdateProjectInput {
  name?: string
}
