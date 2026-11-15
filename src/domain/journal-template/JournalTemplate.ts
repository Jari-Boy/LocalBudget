import type { JournalLineSide } from '../journal/JournalEntry'

/**
 * 仕訳テンプレートの行(計画Issue #201、docs/domain/journal-templates.md)。仕訳の明細行のひな形で、
 * 起票時に「新規仕訳」フォームの行へ展開される。
 */
export interface JournalTemplateLine {
  /** 1始まりの行番号(入力順) */
  lineNo: number
  side: JournalLineSide
  accountId: number
  /** nullは「起票時に入力する」(空欄)。値があるときは正の整数 */
  amount: number | null
  projectId: number | null
  /** nullなら行では決めない。起票時に 科目の既定メンバー > 起票者 の順で決まる */
  householdMemberId: number | null
  counterpartyId: number | null
  settlementBatchId: number | null
}

export interface JournalTemplateLineInput {
  side: JournalLineSide
  accountId: number
  amount?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  settlementBatchId?: number | null
}

/**
 * 仕訳テンプレート。繰り返し周期・提案の概念は持たず(定期仕訳との違い)、起票時の内容の初期値だけを持つ。
 */
export interface JournalTemplate {
  id: number
  /** 全テンプレートで一意(無効のものを含む) */
  name: string
  /** 起票時の摘要の初期値 */
  memo: string | null
  /** 起票者の初期値。nullなら起票時に選ぶ */
  bookkeeperHouseholdMemberId: number | null
  /** 所属グループ。nullは未分類 */
  groupId: number | null
  /** 同じ入れ物(グループ、未分類なら最上位)の中での表示順 */
  sortOrder: number
  isActive: boolean
  lines: JournalTemplateLine[]
  createdAt: string
  updatedAt: string
}

export interface CreateJournalTemplateInput {
  name: string
  memo?: string | null
  bookkeeperHouseholdMemberId?: number | null
  groupId?: number | null
  /** 省略時は同じ入れ物の末尾 */
  sortOrder?: number
  lines: readonly JournalTemplateLineInput[]
}

/** 省略した項目は現在の値のまま。memo・bookkeeperHouseholdMemberId・groupIdはnullで明示的に消去できる */
export interface UpdateJournalTemplateInput {
  name?: string
  memo?: string | null
  bookkeeperHouseholdMemberId?: number | null
  groupId?: number | null
  sortOrder?: number
  /** 指定すると行をまるごと置き換える */
  lines?: readonly JournalTemplateLineInput[]
}
