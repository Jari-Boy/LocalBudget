/**
 * resolveHasExternalStatement(計画Issue #189)のユニットテスト。
 * 科目が外部明細(CSV)を持つかを、登録時の回答(has_external_statement)から求める純粋関数を検証する。
 * 回答を保存する前に作られた行(null)は、照合可否から推定する。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { resolveHasExternalStatement } from './resolveHasExternalStatement'

describe('resolveHasExternalStatement', () => {
  it('登録時の回答があればそのまま返す(CSVあり・残高なしも、CSVなしも区別できる)', () => {
    expect(resolveHasExternalStatement({ hasExternalStatement: true, isReconcilable: false })).toBe(true)
    expect(resolveHasExternalStatement({ hasExternalStatement: false, isReconcilable: false })).toBe(false)
  })

  it('回答が未記録(null)なら、照合する科目は外部明細あり、それ以外はなしと推定する', () => {
    expect(resolveHasExternalStatement({ hasExternalStatement: null, isReconcilable: true })).toBe(true)
    expect(resolveHasExternalStatement({ hasExternalStatement: null, isReconcilable: false })).toBe(false)
    expect(resolveHasExternalStatement({ hasExternalStatement: null, isReconcilable: null })).toBe(false)
  })
})
