import { getLastDayOfMonth } from './getLastDayOfMonth'

/**
 * 'YYYY-MM-DD'形式の日付をmonthsヶ月分シフトする(BS比較機能「前期」=1ヶ月前、
 * docs/domain/financial-statements.md 2.2節・計画Issue #34の懸念点への実装時判断)。
 * シフト先の月に元の日が存在しない場合(例: 3/31の1ヶ月前は2月に31日が無い)は、
 * シフト先の月末日にクランプする。DB非依存の純粋関数。
 */
export function shiftDateByMonths(dateString: string, months: number): string {
  const [year, month, day] = dateString.split('-').map(Number)
  const shiftedYear = year + Math.floor((month - 1 + months) / 12)
  const shiftedMonth = (((month - 1 + months) % 12) + 12) % 12 + 1

  const lastDayOfShiftedMonth = Number(getLastDayOfMonth(shiftedYear, shiftedMonth).split('-')[2])
  const clampedDay = Math.min(day, lastDayOfShiftedMonth)

  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}
