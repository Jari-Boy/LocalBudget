/**
 * canCreateRuleFromEntry(仕訳から定期仕訳を作れるかの判定、計画Issue #180)の純粋関数としてのユニットテスト。
 * 割勘の仕訳(精算バッチに紐づく一回きりの精算)、初期残高・残高調整(システムが作る仕訳)は、繰り返すものでは
 * ないため定期仕訳にできず、手入力・外部明細取込・定期仕訳から生成した仕訳はできることを検証する。
 * 外部依存なし(DB非依存)。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntrySourceType } from '../journal/JournalEntry'
import { canCreateRuleFromEntry } from './canCreateRuleFromEntry'

describe('canCreateRuleFromEntry', () => {
  it.each<JournalEntrySourceType>(['manual', 'external_import', 'recurring_generated'])(
    '%s の仕訳は、定期仕訳にできる',
    (sourceType) => {
      expect(canCreateRuleFromEntry({ sourceType })).toEqual({ allowed: true })
    },
  )

  it.each<JournalEntrySourceType>(['expense_splitting', 'initial_balance', 'balance_adjustment'])(
    '%s の仕訳は、定期仕訳にできず、理由を返す',
    (sourceType) => {
      const result = canCreateRuleFromEntry({ sourceType })

      expect(result.allowed).toBe(false)
      expect(result.allowed === false && result.reason).toMatch(/定期仕訳にできません/)
    },
  )

  it('割勘の仕訳の理由は、割勘が一回きりの精算であることを示す', () => {
    const result = canCreateRuleFromEntry({ sourceType: 'expense_splitting' })

    expect(result.allowed === false && result.reason).toContain('割勘')
  })
})
