/**
 * reconciliationAnswerToIsReconcilable(計画Issue #102で2軸化)のユニットテスト。
 * 「外部明細(CSV)はあるか」×「残高情報は明細にあるか」という2軸の設問回答を
 * is_reconcilable相当のboolean値へ変換する純粋関数の対応関係を検証する。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { reconciliationAnswerToIsReconcilable, type ReconciliationAnswer } from './reconciliationQuestion'

describe('reconciliationAnswerToIsReconcilable', () => {
  it('外部明細ありかつ残高情報ありの場合はtrueに変換される', () => {
    const answer: ReconciliationAnswer = { hasExternalStatement: true, hasBalanceInStatement: true }
    expect(reconciliationAnswerToIsReconcilable(answer)).toBe(true)
  })

  it('外部明細ありかつ残高情報なしの場合はfalseに変換される(クレジットカード相当)', () => {
    const answer: ReconciliationAnswer = { hasExternalStatement: true, hasBalanceInStatement: false }
    expect(reconciliationAnswerToIsReconcilable(answer)).toBe(false)
  })

  it('外部明細なしの場合、残高情報の設問は問われず(hasBalanceInStatement = null)falseに変換される(現金相当)', () => {
    const answer: ReconciliationAnswer = { hasExternalStatement: false, hasBalanceInStatement: null }
    expect(reconciliationAnswerToIsReconcilable(answer)).toBe(false)
  })
})
