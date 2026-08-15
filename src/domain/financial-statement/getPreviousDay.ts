/**
 * 'YYYY-MM-DD'形式の日付の前日を返す(BS比較機能の日付指定モードで、比較基準日を
 * 「基準日より前」に制約するためのHTML `max`属性算出に使う、計画Issue #34)。
 * DB非依存の純粋関数。
 */
export function getPreviousDay(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 1, day - 1))
  const yyyy = String(previous.getUTCFullYear()).padStart(4, '0')
  const mm = String(previous.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(previous.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
