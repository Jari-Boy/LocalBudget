import { shiftDateByMonths } from './shiftDateByMonths'

/**
 * 'YYYY-MM-DD'形式の日付をyears年分シフトする(PL/BS比較機能「前年同期」、
 * docs/domain/financial-statements.md 2.2節)。1年=12ヶ月としてshiftDateByMonthsに
 * 委譲し、うるう年2/29から平年へのシフト等のクランプ処理を再利用する。
 * DB非依存の純粋関数。
 */
export function shiftDateByYears(dateString: string, years: number): string {
  return shiftDateByMonths(dateString, years * 12)
}
