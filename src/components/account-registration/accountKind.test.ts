/**
 * 口座登録ウィザードの「種類」選択肢(docs/domain/accounts.md 4.2節)から
 * is_reconcilable(照合可否)を自動決定するロジックのユニットテスト。
 * 外部依存: なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import { determineIsReconcilable, type AccountKind } from './accountKind'

describe('determineIsReconcilable', () => {
  const cases: Array<{ kind: AccountKind; expected: boolean }> = [
    { kind: 'bank', expected: true },
    { kind: 'e_money', expected: true },
    { kind: 'investment', expected: true },
    { kind: 'cash', expected: false },
  ]

  it.each(cases)('種類が$kindの場合is_reconcilableは$expected', ({ kind, expected }) => {
    expect(determineIsReconcilable(kind)).toBe(expected)
  })
})
