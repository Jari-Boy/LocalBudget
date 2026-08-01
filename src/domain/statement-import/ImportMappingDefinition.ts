export type AmountMode = 'single_signed' | 'debit_credit_split'

export interface ImportMappingDefinition {
  id: number
  accountId: number | null
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
  createdAt: string
  updatedAt: string
}

export interface CreateImportMappingDefinitionInput {
  accountId?: number | null
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
}

export interface UpdateImportMappingDefinitionInput {
  accountId?: number | null
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
}
