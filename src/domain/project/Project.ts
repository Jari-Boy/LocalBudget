export interface Project {
  id: number
  name: string
  /** 所属グループ。nullは未分類(計画Issue #143) */
  projectGroupId: number | null
  /** 所属グループ内(未分類なら全体)での表示順。表示専用 */
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  projectGroupId?: number | null
  sortOrder?: number
}

export interface UpdateProjectInput {
  name?: string
  projectGroupId?: number | null
  sortOrder?: number
}
