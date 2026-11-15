/**
 * 仕訳テンプレートのグループ(計画Issue #201、docs/domain/journal-templates.md参照)。
 * 取引先・プロジェクトのグループと同じ仕様: 入れ子可・単一所属・表示専用。categoryは持たない。
 */
export interface JournalTemplateGroup {
  id: number
  name: string
  parentGroupId: number | null
  /** 同じ入れ物(親グループ、最上位なら全体)の中での表示順。他ノードとの重複可 */
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateJournalTemplateGroupInput {
  name: string
  parentGroupId?: number | null
  sortOrder?: number
}

export interface UpdateJournalTemplateGroupInput {
  name?: string
  parentGroupId?: number | null
  sortOrder?: number
}
