/**
 * プロジェクトグループ(計画Issue #143、docs/domain/projects.md参照)。
 * 勘定科目グループ(AccountGroup)と同じ仕様: 入れ子可・単一所属・表示専用。
 * 勘定科目グループと異なりcategoryは持たない。
 */
export interface ProjectGroup {
  id: number
  name: string
  parentGroupId: number | null
  /** 同じ入れ物(親グループ、最上位なら全体)の中での表示順。他ノードとの重複可 */
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProjectGroupInput {
  name: string
  parentGroupId?: number | null
  sortOrder?: number
}

export interface UpdateProjectGroupInput {
  name?: string
  parentGroupId?: number | null
  sortOrder?: number
}
