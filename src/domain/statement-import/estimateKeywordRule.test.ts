/**
 * estimateKeywordRule(摘要とキーワードルールの照合による、取引先・相手科目の推定)のテスト。
 * 一致したルールが取引先を持てば取引先、科目を持てば相手科目を推定し、別々の取引先または
 * 別々の科目に解決される複数マッチは曖昧として自動確定しないことを検証する
 * (計画Issue #219、docs/decisions.md 2026-11-16 決定4。docs/domain/counterparties.md 1.3)。
 * 複数のキーワードが一致したときの判定は、長さではなく包含関係で行う(計画Issue #260): 最長のキーワードが
 * 一致した他のすべてのキーワードを含むときはそのルールを採用し、独立したキーワードが重なったときは、
 * 同じ取引先・同じ科目に解決されない限り曖昧とする。
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

  it('最長のキーワードが、一致した他のすべてのキーワードを含むときは、そのルールの取引先・科目を採用し、短いルールのものは使わない(AMAZON PRIME ⊃ AMAZON)', () => {
    const result = estimateKeywordRule(
      'AMAZON PRIME AMAZON',
      lookup([rule(1, 'AMAZON', 5, 20), rule(2, 'AMAZON PRIME', 6, 21)]),
    )

    expect(result).toEqual({ counterpartyId: 6, accountId: 21, ambiguous: false })
  })

  it('包含するルールが取引先だけ・科目だけを持つときも、持たない方は短いルールから補わず空のままにする', () => {
    const result = estimateKeywordRule('セブン銀行ATM', lookup([rule(1, 'ATM', 5, null), rule(2, 'セブン銀行ATM', null, 10)]))

    expect(result).toEqual({ counterpartyId: null, accountId: 10, ambiguous: false })
  })

  it('包含の判定は、正規化後の文字列で行う(全角・空白・ひらがな/カタカナを区別しない)', () => {
    const result = estimateKeywordRule('ｱﾏｿﾞﾝ ﾌﾟﾗｲﾑ', lookup([rule(1, 'あまぞん', 5, null), rule(2, 'アマゾン プライム', 6, null)]))

    expect(result).toEqual({ counterpartyId: 6, accountId: null, ambiguous: false })
  })

  it('独立したキーワード(互いに包含しない)が重なり、別々の取引先に解決されるときは曖昧とし、何も推定しない', () => {
    const result = estimateKeywordRule('AEON AMZN', lookup([rule(1, 'AEON', 5, null), rule(2, 'AMZN', 6, null)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('長さが違っても、互いに包含しない独立したキーワードなら曖昧とする(長いほうの総取りにしない)', () => {
    const result = estimateKeywordRule('ローソンATM引出', lookup([rule(1, 'ローソン', 5, null), rule(2, 'ATM', null, 10)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('科目だけのルールと取引先つきのルールが独立して重なったとき、取引先が黙って空になるのではなく曖昧とする', () => {
    const result = estimateKeywordRule('セブン銀行ATM', lookup([rule(1, 'ATM', null, 10), rule(2, 'セブン銀行', 5, null)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('独立したキーワードが重なっても、すべて同じ取引先・同じ科目に解決されるなら曖昧にせず、その結果を採用する', () => {
    const result = estimateKeywordRule('AEON イオン', lookup([rule(1, 'AEON', 5, 20), rule(2, 'イオン', 5, 20)]))

    expect(result).toEqual({ counterpartyId: 5, accountId: 20, ambiguous: false })
  })

  it('独立したキーワードが重なり、取引先は同じでも科目が違うときは曖昧とする', () => {
    const result = estimateKeywordRule('AEON イオン', lookup([rule(1, 'AEON', 5, 20), rule(2, 'イオン', 5, 21)]))

    expect(result).toEqual({ counterpartyId: null, accountId: null, ambiguous: true })
  })

  it('同じ文字列のキーワードが別々の取引先に登録されているときは曖昧とする', () => {
    const result = estimateKeywordRule('スイカ', lookup([rule(1, 'スイカ', 5, null), rule(2, 'スイカ', 6, null)]))

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
