/**
 * rankCounterpartyCandidates(摘要に複数のキーワードが一致した行の、取引先の候補の並び順、計画Issue #236)のテスト。
 * 一致したキーワードが長い順 → 過去の使用件数が多い順 → 名前の五十音順で並べ、同じ取引先は1件にまとめ、
 * 取引先を持たない(科目だけの)ルールは除くことを検証する。外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { rankCounterpartyCandidates } from './rankCounterpartyCandidates'

const rule = (id: number, pattern: string, counterpartyId: number | null): KeywordRule => ({
  id,
  pattern,
  counterpartyId,
  accountId: null,
  createdAt: '2026-11-01',
})

const NAMES = new Map([
  [1, 'ジェイアール東日本'],
  [2, '東京メトロ'],
  [3, 'アイウエオ商店'],
])

describe('rankCounterpartyCandidates', () => {
  it('一致したキーワードが長い取引先を先頭にする', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'スイカ', 2), rule(2, 'ジエイアール東日本', 1)],
      usageCountOf: () => 0,
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([1, 2])
  })

  it('キーワードの長さが同じなら、過去の使用件数が多い取引先を先にする', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'スイカ', 1), rule(2, 'メトロ', 2)],
      usageCountOf: (id) => (id === 2 ? 12 : 3),
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([2, 1])
  })

  it('長さも使用件数も同じなら、名前の五十音順にする', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'スイカ', 1), rule(2, 'メトロ', 2), rule(3, 'ヤマダ', 3)],
      usageCountOf: () => 0,
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([3, 1, 2])
  })

  it('同じ取引先の複数のルールは1件にまとめ、その取引先で最も長いキーワードで順位を決める', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'スイカ', 1), rule(2, 'ジエイアール東日本', 1), rule(3, 'メトロメトロ', 2)],
      usageCountOf: () => 0,
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([1, 2])
  })

  it('取引先を持たない(科目だけの)ルールは候補にしない', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'スイカ', null), rule(2, 'メトロ', 2)],
      usageCountOf: () => 0,
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([2])
  })

  it('キーワードの長さは、照合用の正規化(全角半角・小書き文字など)をした文字列で比べる', () => {
    const ranked = rankCounterpartyCandidates({
      rules: [rule(1, 'ＡＢＣ', 1), rule(2, 'ab', 2)],
      usageCountOf: () => 0,
      nameOf: (id) => NAMES.get(id) ?? '',
    })

    expect(ranked).toEqual([1, 2])
  })
})
