import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { normalizeDescriptionForMatching } from './estimateCounterparty'

/** findMatchingだけを必要とする、KeywordRuleRepositoryの部分依存 */
export interface KeywordRuleLookup {
  findMatching(normalizedText: string): KeywordRule[]
}

export interface KeywordRuleEstimate {
  counterpartyId: number | null
  accountId: number | null
  /** 別々の取引先、または別々の科目に解決される複数マッチ。trueのときは何も推定しない */
  ambiguous: boolean
}

/**
 * 摘要とキーワードルールの照合(docs/domain/statement-import.md 1.5 手順4、docs/domain/counterparties.md 1.3、
 * 計画Issue #219)。摘要を正規化してルールと部分一致で照合し、一致したルールが取引先を持てば取引先、
 * 科目を持てば相手科目を推定する。別々の取引先、または別々の科目に解決される複数マッチは曖昧として
 * 何も推定せず(ambiguous: true)、レビュー画面でのユーザー選択に委ねる。同じ取引先・同じ科目に
 * 解決されるなら、複数のルールが一致しても一意とみなす。
 */
export function estimateKeywordRule(description: string, lookup: KeywordRuleLookup): KeywordRuleEstimate {
  const matches = lookup.findMatching(normalizeDescriptionForMatching(description))
  const counterpartyIds = new Set(matches.flatMap((m) => (m.counterpartyId === null ? [] : [m.counterpartyId])))
  const accountIds = new Set(matches.flatMap((m) => (m.accountId === null ? [] : [m.accountId])))
  if (counterpartyIds.size > 1 || accountIds.size > 1) {
    return { counterpartyId: null, accountId: null, ambiguous: true }
  }
  return {
    counterpartyId: counterpartyIds.size === 1 ? [...counterpartyIds][0] : null,
    accountId: accountIds.size === 1 ? [...accountIds][0] : null,
    ambiguous: false,
  }
}
