export type RecurringTransactionFrequency = 'weekly' | 'monthly' | 'yearly'

export interface RecurringTransactionRule {
  id: number
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  monthOfYear: number | null
  projectId: number | null
  householdMemberId: number | null
  counterpartyId: number | null
  maxOccurrences: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateRecurringTransactionRuleInput {
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  maxOccurrences?: number | null
}

export interface UpdateRecurringTransactionRuleInput {
  name: string
  debitAccountId: number
  creditAccountId: number
  amount: number
  frequency: RecurringTransactionFrequency
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  weekOfMonth?: number | null
  monthOfYear?: number | null
  projectId?: number | null
  householdMemberId?: number | null
  counterpartyId?: number | null
  maxOccurrences?: number | null
}
