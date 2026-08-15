/**
 * 年+月(1-12)から月初日を'YYYY-MM-DD'形式で返す(docs/domain/financial-statements.md 2.2節の
 * 月次プリセット実現のため)。DB非依存の純粋関数。
 */
export function getFirstDayOfMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}
