/**
 * rankAccountCandidates(摘要に複数のキーワードが一致して決まらなかった行の、相手科目の候補の並び順、計画Issue #260)のテスト。
 * 一致したキーワードが長い順 → 科目名の五十音順で並べ、同じ科目は1件にまとめ、科目を持たない(取引先だけの)
 * ルールは除くことを検証する。取引先側の rankCounterpartyCandidates(計画Issue #236)と同じ考え方。外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { rankAccountCandidates } from './rankAccountCandidates'

const rule = (id: number, pattern: string, accountId: number | null): KeywordRule => ({
  id,
  pattern,
  counterpartyId: null,
  accountId,
  createdAt: '2026-11-01',
})

const NAMES = new Map([
  [1, '現金'],
  [2, '普通預金'],
  [3, 'アイウエオ費'],
])
const nameOf = (id: number) => NAMES.get(id) ?? ''

describe('rankAccountCandidates', () => {
  it('一致したキーワードが長い科目を先頭にする', () => {
    expect(rankAccountCandidates({ rules: [rule(1, 'ATM', 1), rule(2, 'セブン銀行', 2)], nameOf })).toEqual([2, 1])
  })

  it('キーワードの長さが同じなら、科目名の五十音順にする', () => {
    expect(rankAccountCandidates({ rules: [rule(1, 'ATM', 2), rule(2, 'VIS', 1), rule(3, 'XYZ', 3)], nameOf })).toEqual([3, 1, 2])
  })

  it('同じ科目の複数のルールは1件にまとめ、その科目で最も長いキーワードで順位を決める', () => {
    expect(
      rankAccountCandidates({ rules: [rule(1, 'ATM', 1), rule(2, 'セブン銀行ATM', 1), rule(3, 'ゆうちょ', 2)], nameOf }),
    ).toEqual([1, 2])
  })

  it('科目を持たない(取引先だけの)ルールは候補にしない', () => {
    expect(rankAccountCandidates({ rules: [rule(1, 'スイカ', null), rule(2, 'ATM', 1)], nameOf })).toEqual([1])
  })

  it('キーワードの長さは、照合用の正規化(全角半角など)をした文字列で比べる', () => {
    expect(rankAccountCandidates({ rules: [rule(1, 'ＡＢＣ', 1), rule(2, 'ab', 2)], nameOf })).toEqual([1, 2])
  })
})
