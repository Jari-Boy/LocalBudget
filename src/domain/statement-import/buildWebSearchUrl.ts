/**
 * 明細取込画面の摘要のウェブ検索リンク(計画Issue #283)の行き先のURLを作る。
 * 摘要の文字列を検索語(q)にしたGoogleの検索ページのURLを返す純粋関数。ネットワークには接続しない
 * (利用者が画面のリンクを押したときだけ、ブラウザが別タブで開く)。
 *
 * 検索語は URLSearchParams でエンコードするため、日本語・空白・記号・URLの予約文字(& = # % + など)を含んでも
 * 検索語の外へ漏れない。前後の空白は取り除く。検索エンジンはGoogle固定(設定で選ぶ機能は持たない)。
 */
const SEARCH_ENDPOINT = 'https://www.google.com/search'

export function buildWebSearchUrl(description: string): string {
  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('q', description.trim())
  return url.toString()
}
