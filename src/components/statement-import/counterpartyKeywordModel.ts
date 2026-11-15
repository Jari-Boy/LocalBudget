import { normalizeDescriptionForMatching } from '../../domain/statement-import/estimateCounterparty'

/**
 * 取引先のキーワード(画面上の呼び名。データモデルでは取引先のパターン)の検証と一致判定(計画Issue #207)。
 * 明細取込の「取引先の設定」と、取引先の追加ダイアログで共通に使う。DB・DOM非依存の純粋関数。
 */

export type KeywordError = 'empty' | 'duplicate' | 'notInDescription'

/**
 * キーワード1件の問題を返す(問題がなければnull)。空、正規化(全角半角・大文字小文字・空白除去)後に
 * 他のキーワードと同じ(重複)、元の摘要が指定されているのにそこに含まれない文字列、の順に判定する。
 * 元の摘要は、新しく登録するキーワードにだけ渡す(登録済みキーワードの編集には「摘要に含まれる」条件をかけない)。
 */
export function validateKeyword(params: {
  text: string
  otherTexts: readonly string[]
  sourceDescription: string | null
}): KeywordError | null {
  const normalized = normalizeDescriptionForMatching(params.text)
  if (normalized.length === 0) return 'empty'
  if (params.otherTexts.some((other) => normalizeDescriptionForMatching(other) === normalized)) return 'duplicate'
  if (params.sourceDescription !== null && !normalizeDescriptionForMatching(params.sourceDescription).includes(normalized)) {
    return 'notInDescription'
  }
  return null
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
