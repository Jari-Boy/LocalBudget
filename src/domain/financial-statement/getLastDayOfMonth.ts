/**
 * 年+月(1-12)から月末日を'YYYY-MM-DD'形式で返す(docs/domain/financial-statements.md 2.2節の
 * 月次プリセット実現のため)。うるう年2月・月ごとの日数差はDateのオーバーフロー正規化
 * (翌月0日目=当月末日)で機械的に求め、自前の日数テーブルを持たない。DB非依存の純粋関数。
 */
export function getLastDayOfMonth(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0))
  const yyyy = String(lastDay.getUTCFullYear()).padStart(4, '0')
  const mm = String(lastDay.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(lastDay.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
