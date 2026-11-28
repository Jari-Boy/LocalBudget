/**
 * 検索用の正規化(計画Issue #233で選択欄用に作成、計画Issue #303でdomain層へ移し仕訳の摘要検索にも使う)。画面から独立した純粋関数。
 * NFKC(全角半角・半角カナの統一)→ 小文字化 → カタカナをひらがなへ → 空白除去。
 * 漢字は変換せず、そのまま比較する(読み仮名検索は対象外)。
 * 取込の摘要照合(normalizeDescriptionForMatching: 大文字化・ハイフンの長音化つき)とは用途が違うため別の関数にしている。
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
}

/** 名前が検索語を(正規化したうえで)含むか。検索語が空(空白のみ含む)なら常にtrue */
export function matchesSearch(name: string, query: string): boolean {
  const q = normalizeForSearch(query)
  return q === '' || normalizeForSearch(name).includes(q)
}
