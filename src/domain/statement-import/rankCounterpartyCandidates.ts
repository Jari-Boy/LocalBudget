import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { normalizeDescriptionForMatching } from './estimateCounterparty'

const collator = new Intl.Collator('ja')

/**
 * 摘要に一致したキーワードルールから、取引先の候補の並びを作る(計画Issue #236)。取引先の選択欄を開いたとき、
 * この順に先頭へ出す。並びは、(1) その取引先で一致したキーワードのうち最も長いもの(照合用の正規化後の文字数)が長い順、
 * (2) 同じなら過去の使用件数が多い順、(3) それも同じなら名前の五十音順。同じ取引先は1件にまとめ、
 * 取引先を持たない(科目だけの)ルールは候補にしない。自動では割り当てない(選ぶのは利用者)。
 */
export function rankCounterpartyCandidates(params: {
  rules: readonly KeywordRule[]
  usageCountOf: (counterpartyId: number) => number
  nameOf: (counterpartyId: number) => string
}): number[] {
  const longestByCounterparty = new Map<number, number>()
  for (const rule of params.rules) {
    if (rule.counterpartyId === null) continue
    const length = normalizeDescriptionForMatching(rule.pattern).length
    longestByCounterparty.set(rule.counterpartyId, Math.max(length, longestByCounterparty.get(rule.counterpartyId) ?? 0))
  }
  return [...longestByCounterparty.keys()].sort(
    (a, b) =>
      longestByCounterparty.get(b)! - longestByCounterparty.get(a)! ||
      params.usageCountOf(b) - params.usageCountOf(a) ||
      collator.compare(params.nameOf(a), params.nameOf(b)),
  )
}
