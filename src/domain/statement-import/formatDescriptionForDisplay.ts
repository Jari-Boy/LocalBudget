/**
 * 明細の摘要を、画面に表示する形にそろえる。半角カナ・全角英数・全角空白などを標準化する(NFKC)ので、
 * 同じ意味の摘要が銀行ごとの表記の違いで別々に見えない。取り込む元の摘要(CSVの値)は変えない。
 * 照合用の正規化(normalizeDescriptionForMatching)と違い、大文字小文字と、語の間の空白は残す。
 */
export function formatDescriptionForDisplay(text: string): string {
  // 「シ+空白+独立した濁点」は、濁点の直前の空白だけを詰めて合成する(計画Issue #279)。ほかの空白は詰めない
  return unifyKatakanaHyphen(text.normalize('NFKC'))
    .replace(/\s+(?=[゙゚])/g, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
}

/** カタカナ(長音を含む)につづくハイフン・ダッシュ類。NFKCのあとの文字に使う(全角ハイフンはNFKCで「-」になる) */
const KATAKANA_HYPHEN = /(?<=[゠-ヿ])[-‐-―−－ｰ]/g

/**
 * カタカナにつづくハイフン類を、長音「ー」にそろえる(「ﾌｧﾐﾘ-ﾏ-ﾄ」を「ファミリーマート」にするため)。
 * 電話番号・日付・英数字のハイフンは、カタカナにつづかないので変えない。NFKCをかけたあとの文字列に使う。
 */
export function unifyKatakanaHyphen(nfkcText: string): string {
  return nfkcText.replace(KATAKANA_HYPHEN, 'ー')
}
