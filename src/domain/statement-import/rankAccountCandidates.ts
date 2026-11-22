import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { normalizeDescriptionForMatching } from './estimateCounterparty'

const collator = new Intl.Collator('ja')

/**
 * 摘要に複数のキーワードが一致して決まらなかった行の、相手科目の候補の並びを作る(計画Issue #260)。相手科目の
 * 選択欄を開いたとき、この順に先頭へ出す。並びは、(1) その科目で一致したキーワードのうち最も長いもの(照合用の
 * 正規化後の文字数)が長い順、(2) 同じなら科目名の五十音順。同じ科目は1件にまとめ、科目を持たない(取引先だけの)
 * ルールは候補にしない。自動では割り当てない(選ぶのは利用者)。取引先側の rankCounterpartyCandidates と対になる。
 */
export function rankAccountCandidates(params: {
  rules: readonly KeywordRule[]
  nameOf: (accountId: number) => string
}): number[] {
  const longestByAccount = new Map<number, number>()
  for (const rule of params.rules) {
    if (rule.accountId === null) continue
    const length = normalizeDescriptionForMatching(rule.pattern).length
    longestByAccount.set(rule.accountId, Math.max(length, longestByAccount.get(rule.accountId) ?? 0))
  }
  return [...longestByAccount.keys()].sort(
    (a, b) => longestByAccount.get(b)! - longestByAccount.get(a)! || collator.compare(params.nameOf(a), params.nameOf(b)),
  )
}
