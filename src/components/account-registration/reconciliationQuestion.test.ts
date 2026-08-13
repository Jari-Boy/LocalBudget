/**
 * reconciliationAnswerToIsReconcilable(将来の科目作成UI拡張向けの土台、計画Issue #92)の
 * ユニットテスト。「外部明細と自動で突合するか」という専門用語なしの設問の回答を
 * is_reconcilable相当のboolean値へ変換する純粋関数の対応関係を検証する。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { reconciliationAnswerToIsReconcilable } from './reconciliationQuestion'

describe('reconciliationAnswerToIsReconcilable', () => {
  it('matches_external_statement(外部明細と自動で突合する)はtrueに変換される', () => {
    expect(reconciliationAnswerToIsReconcilable('matches_external_statement')).toBe(true)
  })

  it('manual_only(外部明細と自動で突合しない、手入力のみ)はfalseに変換される', () => {
    expect(reconciliationAnswerToIsReconcilable('manual_only')).toBe(false)
  })
})
