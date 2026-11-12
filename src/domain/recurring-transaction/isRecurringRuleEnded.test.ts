/**
 * isRecurringRuleEnded(ルールの終了判定、計画Issue #164)の純粋関数としてのユニットテスト。
 * 終了日の経過(終了日の当日はまだ終了していない)と、回数の上限への到達(生成済み件数で判定)の
 * どちらか一方でも満たせば終了と判定すること、どちらの指定も無ければ終了しないこと、
 * is_activeとは独立していること(無効なルールでも期間内なら終了ではない)を検証する。計画Issue #180で追加した、
 * 金額表のルールは表の最後の回まで生成したら終了する(回数の上限が表の長さに自動で揃う)ことも検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { isRecurringRuleEnded } from './isRecurringRuleEnded'

const base = { endsOn: null, maxOccurrences: null, amountMode: 'fixed' as const, schedule: [] }
const tableRound = (round: number) => ({ round, amounts: [] })

describe('isRecurringRuleEnded', () => {
  it('終了日も回数の上限も無いルールは終了しない', () => {
    expect(isRecurringRuleEnded(base, 100, '2030-01-01')).toBe(false)
  })

  it('終了日の当日はまだ終了していない', () => {
    expect(isRecurringRuleEnded({ ...base, endsOn: '2026-09-30' }, 0, '2026-09-30')).toBe(false)
  })

  it('終了日の翌日から終了している', () => {
    expect(isRecurringRuleEnded({ ...base, endsOn: '2026-09-30' }, 0, '2026-10-01')).toBe(true)
  })

  it('生成済み件数が回数の上限に達したら終了している', () => {
    expect(isRecurringRuleEnded({ ...base, maxOccurrences: 3 }, 3, '2026-01-01')).toBe(true)
  })

  it('生成済み件数が回数の上限に満たなければ終了していない', () => {
    expect(isRecurringRuleEnded({ ...base, maxOccurrences: 3 }, 2, '2026-01-01')).toBe(false)
  })

  it('終了日と回数の上限の両方がある場合、どちらか一方を満たせば終了している', () => {
    const rule = { ...base, endsOn: '2026-12-31', maxOccurrences: 3 }
    expect(isRecurringRuleEnded(rule, 3, '2026-01-01')).toBe(true)
    expect(isRecurringRuleEnded(rule, 0, '2027-01-01')).toBe(true)
    expect(isRecurringRuleEnded(rule, 2, '2026-12-31')).toBe(false)
  })

  it('金額表のルールは、表の最後の回まで生成したら終了している(見送っても回は進まないので件数は生成済みの仕訳のみ)', () => {
    const rule = { ...base, amountMode: 'schedule' as const, schedule: [tableRound(1), tableRound(2), tableRound(3)] }

    expect(isRecurringRuleEnded(rule, 2, '2026-01-01')).toBe(false)
    expect(isRecurringRuleEnded(rule, 3, '2026-01-01')).toBe(true)
  })

  it('金額表のルールに回数の上限もあれば、表の長さより小さい上限で終了する', () => {
    const rule = { ...base, amountMode: 'schedule' as const, maxOccurrences: 2, schedule: [tableRound(1), tableRound(2), tableRound(3)] }

    expect(isRecurringRuleEnded(rule, 2, '2026-01-01')).toBe(true)
  })
})
