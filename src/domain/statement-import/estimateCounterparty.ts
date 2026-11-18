import { unifyKatakanaHyphen } from './formatDescriptionForDisplay'

/**
 * CSV摘要文字列とkeyword_rulesのマッチング用に正規化する
 * (docs/domain/counterparties.md 1.3 手順1: 全角半角統一・大文字小文字統一・空白除去)。
 * 照合そのものは estimateKeywordRule.ts(計画Issue #219)。
 */
export function normalizeDescriptionForMatching(text: string): string {
  return unifyKatakanaHyphen(text.normalize('NFKC')).toUpperCase().replace(/\s+/g, '')
}
