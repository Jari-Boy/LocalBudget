import { unifyKatakanaHyphen } from './formatDescriptionForDisplay'

/** カタカナ・ひらがなの小書き文字と、対応する大きい文字(カタカナ)。ヵ・ヶ・ゕ・ゖも カ・ケ にそろえる */
const SMALL_KANA_TO_LARGE: Readonly<Record<string, string>> = {
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ',
}

/**
 * ひらがなをカタカナにし、カタカナの小書き文字を大きい文字にそろえる(計画Issue #236)。
 * 「ジェイアール」と「ジエイアール」、「じぇいあーる」を、同じ文字列として扱うため。NFKCをかけたあとの文字列に使う。
 */
export function foldKana(nfkcText: string): string {
  return nfkcText
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (ch) => SMALL_KANA_TO_LARGE[ch])
}

/**
 * CSV摘要文字列とkeyword_rulesのマッチング用に正規化する
 * (docs/domain/counterparties.md 1.3 手順1: 全角半角統一・大文字小文字統一・空白除去。
 * 計画Issue #236で、ひらがな/カタカナと小書き文字の区別をしない規則を加えた)。
 * 照合そのものは estimateKeywordRule.ts(計画Issue #219)。
 *
 * 銀行の摘要には「シ+空白+独立した濁点」の形がある(「ワイシ ゙エイカート ゙」)。NFKCの時点では空白が間にあって
 * 合成されないので、空白を取り除いたあとにNFCをかけて、結合文字の濁点・半濁点を1文字にまとめる(計画Issue #279)。
 */
export function normalizeDescriptionForMatching(text: string): string {
  return unifyKatakanaHyphen(foldKana(text.normalize('NFKC')))
    .toUpperCase()
    .replace(/\s+/g, '')
    .normalize('NFC')
}
