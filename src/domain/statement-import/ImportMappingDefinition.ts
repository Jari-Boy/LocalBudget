export type AmountMode = 'single_signed' | 'debit_credit_split'

export interface ImportMappingDefinition {
  id: number
  /** 対応する科目のID(科目ID昇順)。制限ではなく取込時の候補の優先順位に使う。未紐づけなら空配列 */
  accountIds: number[]
  formatGroupId: string
  isSettled: boolean | null
  label: string
  encoding: string
  delimiter: string
  headerRowCount: number
  dateColumn: string
  dateFormat: string
  descriptionColumn: string
  amountMode: AmountMode
  amountColumn: string | null
  debitColumn: string | null
  creditColumn: string | null
  balanceColumn: string | null
  externalIdColumn: string | null
  /** 金額の符号を反転して読む。amountMode が single_signed のときだけ有効(計画Issue #192) */
  invertAmountSign: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateImportMappingDefinitionInput {
  accountIds?: number[]
  formatGroupId: string
  isSettled?: boolean | null
  label: string
  encoding?: string
  delimiter?: string
  headerRowCount?: number
  dateColumn: string
  dateFormat: string
  descriptionColumn: string
  amountMode: AmountMode
  amountColumn?: string | null
  debitColumn?: string | null
  creditColumn?: string | null
  balanceColumn?: string | null
  externalIdColumn?: string | null
  invertAmountSign?: boolean
}

export interface UpdateImportMappingDefinitionInput {
  accountIds?: number[]
  formatGroupId?: string
  isSettled?: boolean | null
  label?: string
  encoding?: string
  delimiter?: string
  headerRowCount?: number
  dateColumn?: string
  dateFormat?: string
  descriptionColumn?: string
  amountMode?: AmountMode
  amountColumn?: string | null
  debitColumn?: string | null
  creditColumn?: string | null
  balanceColumn?: string | null
  externalIdColumn?: string | null
  invertAmountSign?: boolean
}
