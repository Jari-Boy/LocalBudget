/**
 * キーワードルール(keyword_rules)。明細取込の摘要に含まれるキーワードから、取引先(任意)と
 * 相手科目(任意)を推定するための1件のルール(計画Issue #219、docs/decisions/2026-11-16-06.md 2026-11-16)。
 * 取引先か科目の少なくとも一方は必須。取引先と科目の両方を持てるのは、科目が収益・費用のときだけ。
 */
export interface KeywordRule {
  id: number
  pattern: string
  counterpartyId: number | null
  accountId: number | null
  createdAt: string
}

export interface CreateKeywordRuleInput {
  pattern: string
  counterpartyId?: number | null
  accountId?: number | null
}

export interface UpdateKeywordRuleInput {
  pattern?: string
  counterpartyId?: number | null
  accountId?: number | null
}
