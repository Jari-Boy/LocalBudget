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
 * 計画Issue #219、docs/decisions.md 2026-11-16 決定11・12)。摘要を正規化してルールと部分一致で照合し、
 * 複数のルールが一致したときは**最も長いキーワード**(正規化後の文字数)のルールを採用して、そのルールの
 * 取引先と科目をそのまま使う。採用したルールが持たない方は空のままにし、短いルールからは補わない。
 * 最長のキーワードが同じ長さで複数あり、別々の取引先、または別々の科目に解決されるときだけ曖昧として
 * 何も推定せず(ambiguous: true)、レビュー画面でのユーザー選択に委ねる。同じ取引先・同じ科目に
 * 解決されるなら一意とみなす。
 */
export function estimateKeywordRule(description: string, lookup: KeywordRuleLookup): KeywordRuleEstimate {
  const matches = lookup.findMatching(normalizeDescriptionForMatching(description))
  const lengthOf = (rule: KeywordRule) => normalizeDescriptionForMatching(rule.pattern).length
  const longest = Math.max(0, ...matches.map(lengthOf))
  const winners = matches.filter((m) => lengthOf(m) === longest)
  const counterpartyIds = new Set(winners.flatMap((m) => (m.counterpartyId === null ? [] : [m.counterpartyId])))
  const accountIds = new Set(winners.flatMap((m) => (m.accountId === null ? [] : [m.accountId])))
  if (counterpartyIds.size > 1 || accountIds.size > 1) {
    return { counterpartyId: null, accountId: null, ambiguous: true }
  }
  return {
    counterpartyId: counterpartyIds.size === 1 ? [...counterpartyIds][0] : null,
    accountId: accountIds.size === 1 ? [...accountIds][0] : null,
    ambiguous: false,
  }
}
