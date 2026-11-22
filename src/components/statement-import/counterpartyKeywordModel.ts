import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'

/**
 * 取引先のキーワード(画面上の呼び名。データモデルでは取引先のパターン)の検証と一致判定(計画Issue #207)。
 * 明細取込の「取引先の設定」と、取引先の追加ダイアログで共通に使う。DB・DOM非依存の純粋関数。
 */

export type KeywordError = 'empty' | 'duplicate'

/**
 * キーワード1件の問題を返す(問題がなければnull)。空、正規化(全角半角・大文字小文字・空白除去・
 * ひらがな/カタカナ・小書き文字の統一)後に他のキーワードと同じ(重複)、の順に判定する。
 * 現在の明細の摘要に含まれない文字列も登録できる(計画Issue #236。含む行が0行になるだけで、画面で注意を出す)。
 */
export function validateKeyword(params: { text: string; otherTexts: readonly string[] }): KeywordError | null {
  const normalized = normalizeDescriptionForMatching(params.text)
  if (normalized.length === 0) return 'empty'
  if (params.otherTexts.some((other) => normalizeDescriptionForMatching(other) === normalized)) return 'duplicate'
  return null
}

/**
 * 新しいキーワードの科目の初期値(計画Issue #236)。キーワードに紐づく科目(未設定のnullは数えない)のうち、
 * 最も多く使われているもののid。件数が同数で並ぶとき、数えるものが無いときはnull(結果を不安定に見せないため、
 * 同数のときは決めずに利用者が選ぶ)。取引先を持てない科目は、呼び出し側で除いてから渡す。
 */
export function mostFrequentAccountId(accountIds: readonly (number | null)[]): number | null {
  const counts = new Map<number, number>()
  for (const id of accountIds) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1)
  let best: number | null = null
  let bestCount = 0
  let tied = false
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
      tied = false
    } else if (count === bestCount) {
      tied = true
    }
  }
  return tied ? null : best
}

/** キーワード(正規化して部分一致)を含む摘要の数。空のキーワードはどの摘要にも含まれないものとして数える */
export function countRowsContaining(text: string, descriptions: readonly string[]): number {
  const normalized = normalizeDescriptionForMatching(text)
  if (normalized.length === 0) return 0
  return descriptions.filter((description) => normalizeDescriptionForMatching(description).includes(normalized)).length
}

/** キーワードのどれか1つでも摘要に含まれるか(OR)。空のキーワードは無視する */
export function anyKeywordMatches(texts: readonly string[], description: string): boolean {
  const normalizedDescription = normalizeDescriptionForMatching(description)
  return texts.some((text) => {
    const normalized = normalizeDescriptionForMatching(text)
    return normalized.length > 0 && normalizedDescription.includes(normalized)
  })
}

/** キーワード1件が摘要に含まれるか(正規化して部分一致)。空のキーワードは含まれないものとする */
export function matchesKeyword(text: string, description: string): boolean {
  const normalized = normalizeDescriptionForMatching(text)
  return normalized.length > 0 && normalizeDescriptionForMatching(description).includes(normalized)
}
