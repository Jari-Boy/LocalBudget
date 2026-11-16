/**
 * estimateKeywordRule(摘要とキーワードルールの照合による、取引先・相手科目の推定)のテスト。
 * 一致したルールが取引先を持てば取引先、科目を持てば相手科目を推定し、別々の取引先または
 * 別々の科目に解決される複数マッチは曖昧として自動確定しないことを検証する
 * (計画Issue #219、docs/decisions.md 2026-11-16 決定4。docs/domain/counterparties.md 1.3)。
 * 外部依存なし(Repositoryはスタブ)。
 */
import { describe, expect, it } from 'vitest'
import type { KeywordRule } from '../keyword-rule/KeywordRule'
import { estimateKeywordRule } from './estimateKeywordRule'

const rule = (id: number, pattern: string, counterpartyId: number | null, accountId: number | null): KeywordRule => ({
  id,
  pattern,
  counterpartyId,
  accountId,
  createdAt: '2026-01-01 00:00:00',
})

/** findMatchingが渡された正規化済み摘要に対し固定のルールを返すスタブ */
const lookup = (matches: KeywordRule[]) => ({ findMatching: () => matches })

describe('estimateKeywordRule', () => {
  it('一致が0件なら取引先も科目も推定しない', () => {
    expect(estimateKeywordRule('なにか', lookup([]))).toEqual({ counterpartyId: null, accountId: null, ambiguous: false })
  })

  it('科目だけのルールが一致すれば、相手科目だけを推定する(資産・負債の行)', () => {
    expect(estimateKeywordRule('ATM引出', lookup([rule(1, 'ATM', null, 10)]))).toEqual({
      counterpartyId: null,
      accountId: 10,
      ambiguous: false,
    })
  })

  it('取引先だけのルールが一致すれば、取引先だけを推定する', () => {
    expect(estimateKeywordRule('AEON', lookup([rule(1, 'AEON', 5, null)]))).toEqual({
      counterpartyId: 5,
      accountId: null,
      ambiguous: false,
    })
  })

  it('同じ取引先・同じ科目に解決される複数のルールは、一意とみなす', () => {
    const result = estimateKeywordRule('AEONイオン', lookup([rule(1, 'AEON', 5, 20), rule(2, 'イオン', 5, 20)]))

    expect(result).toEqual({ counterpartyId: 5, accountId: 20, ambiguous: false })
  })

  it('別々の取引先に解決される複数のルールは曖昧とし、何も推定しない', () => {
    const result = estimateKeywordRule('AEON AMAZON', lookup([rule(1, 'AEON', 5, null), rule(2, 'AMAZON', 6, null)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('別々の科目に解決される複数のルールは曖昧とし、何も推定しない', () => {
    const result = estimateKeywordRule('ATM VISA', lookup([rule(1, 'ATM', null, 10), rule(2, 'VISA', null, 11)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('摘要は正規化(全角半角・大文字小文字・空白除去)してから照合する', () => {
    let received = ''
    estimateKeywordRule('ａｔｍ 引出', {
      findMatching: (text) => {
        received = text
        return []
      },
    })

    expect(received).toBe('ATM引出')
  })
})
