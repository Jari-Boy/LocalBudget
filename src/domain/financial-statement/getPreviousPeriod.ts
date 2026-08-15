import type { Period } from './Period'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toUtcDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function toDateString(date: Date): string {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * PL比較機能の「前期」(docs/domain/financial-statements.md 2.2節「比較」)。
 * 同じ長さ(日数)の直前期間を返す。月次・年次のプリセット期間だけでなく、
 * 任意のカスタム期間でも機械的に定義できるよう日数ベースで計算する
 * (計画Issue #34の懸念点「前期の定義」に対する実装時判断)。DB非依存の純粋関数。
 */
export function getPreviousPeriod(period: Period): Period {
  const from = toUtcDate(period.from)
  const to = toUtcDate(period.to)
  const lengthDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1

  const previousTo = new Date(from.getTime() - MS_PER_DAY)
  const previousFrom = new Date(previousTo.getTime() - (lengthDays - 1) * MS_PER_DAY)

  return { from: toDateString(previousFrom), to: toDateString(previousTo) }
}
