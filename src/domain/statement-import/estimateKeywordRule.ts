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
 * 計画Issue #219・#260、docs/decisions.md 2026-11-16 決定11・12と2026-11-22)。摘要を正規化してルールと部分一致で照合する。
 * 複数のルールが一致したときの判定は、長さではなく**包含関係**で行う(包含は正規化後の文字列で比べる)。
 * - 最も長いキーワードが、一致した他のすべてのキーワードを含むときは、より具体的なルールとして、
 *   そのルールの取引先と科目をそのまま使う(AMAZON PRIME ⊃ AMAZON)。採用したルールが持たない方は空のままにし、
 *   短いルールからは補わない。最長が同じ文字列で複数あるときは、別々の取引先、または別々の科目に解決されるなら曖昧とする。
 * - 互いに包含しない独立したキーワードが重なったときは、すべてが同じ取引先・同じ科目に解決される場合だけ
 *   その結果を使い、そうでなければ曖昧とする(取引先を持たないルールが最長だからと、取引先が黙って空にならない)。
 * 曖昧のときは何も推定せず(ambiguous: true)、レビュー画面で取引先・相手科目の候補から選ぶ。
 */
export function estimateKeywordRule(description: string, lookup: KeywordRuleLookup): KeywordRuleEstimate {
  const matches = lookup.findMatching(normalizeDescriptionForMatching(description))
  if (matches.length === 0) return { counterpartyId: null, accountId: null, ambiguous: false }
  const patternOf = (rule: KeywordRule) => normalizeDescriptionForMatching(rule.pattern)
  const longest = matches.reduce((best, rule) => (patternOf(rule).length > patternOf(best).length ? rule : best))
  const longestText = patternOf(longest)
  const dominant = matches.every((rule) => longestText.includes(patternOf(rule)))
  // 最長のキーワードがほかのすべてを含むなら、同じ文字列のルールだけが採用の候補。含まないなら独立したキーワードが重なっている
  const candidates = dominant ? matches.filter((rule) => patternOf(rule) === longestText) : matches
  if (dominant) {
    const counterpartyIds = new Set(candidates.flatMap((m) => (m.counterpartyId === null ? [] : [m.counterpartyId])))
    const accountIds = new Set(candidates.flatMap((m) => (m.accountId === null ? [] : [m.accountId])))
    if (counterpartyIds.size > 1 || accountIds.size > 1) return { counterpartyId: null, accountId: null, ambiguous: true }
    return {
      counterpartyId: counterpartyIds.size === 1 ? [...counterpartyIds][0] : null,
      accountId: accountIds.size === 1 ? [...accountIds][0] : null,
      ambiguous: false,
    }
  }
  // 独立したキーワード同士は、取引先・科目の組がすべて同じときだけ一意(別々のルールから取引先と科目を組み合わせない)
  const resolved = new Set(candidates.map((m) => `${m.counterpartyId ?? ''}/${m.accountId ?? ''}`))
  if (resolved.size > 1) return { counterpartyId: null, accountId: null, ambiguous: true }
  return { counterpartyId: candidates[0].counterpartyId, accountId: candidates[0].accountId, ambiguous: false }
}
