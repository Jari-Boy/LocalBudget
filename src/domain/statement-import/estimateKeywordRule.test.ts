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

  it('複数のルールが一致したときは、最も長いキーワードのルールを採用し、短いキーワードの取引先・科目は使わない', () => {
    const result = estimateKeywordRule(
      'AMAZON PRIME AMAZON',
      lookup([rule(1, 'AMAZON', 5, 20), rule(2, 'AMAZON PRIME', 6, 21)]),
    )

    expect(result).toEqual({ counterpartyId: 6, accountId: 21, ambiguous: false })
  })

  it('採用したルールが持たない方(取引先だけ・科目だけ)は、短いルールから補わず空のままにする', () => {
    const result = estimateKeywordRule('セブン銀行ATM', lookup([rule(1, 'ATM', null, 10), rule(2, 'セブン銀行', 5, null)]))

    expect(result).toEqual({ counterpartyId: 5, accountId: null, ambiguous: false })
  })

  it('長さの比較は、正規化後の文字数で行う(全角・空白を除いた長さ)', () => {
    const result = estimateKeywordRule('ATM VISA', lookup([rule(1, 'ＡＴＭ', null, 10), rule(2, 'V I S A', null, 11)]))

    expect(result).toEqual({ counterpartyId: null, accountId: 11, ambiguous: false })
  })

  it('最長のキーワードが同じ長さで複数あり、別々の取引先に解決されるときだけ曖昧とし、何も推定しない', () => {
    const result = estimateKeywordRule('AEON AMZN', lookup([rule(1, 'AEON', 5, null), rule(2, 'AMZN', 6, null)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('最長のキーワードが同じ長さで複数あり、別々の科目に解決されるときも曖昧とする', () => {
    const result = estimateKeywordRule('ATM VISA', lookup([rule(1, 'ATM1', null, 10), rule(2, 'VIS2', null, 11)]))

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
