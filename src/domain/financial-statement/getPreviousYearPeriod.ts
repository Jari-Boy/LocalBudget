import type { Period } from './Period'
import { shiftDateByYears } from './shiftDateByYears'

/**
 * PL比較機能の「前年同期」(docs/domain/financial-statements.md 2.2節「比較」)。
 * 開始日・終了日をともに1年前にずらした期間を返す。DB非依存の純粋関数。
 */
export function getPreviousYearPeriod(period: Period): Period {
  return {
    from: shiftDateByYears(period.from, -1),
    to: shiftDateByYears(period.to, -1),
  }
}
