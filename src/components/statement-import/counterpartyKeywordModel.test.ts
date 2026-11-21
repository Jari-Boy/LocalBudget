/**
 * counterpartyKeywordModel(明細取込の「取引先の設定」・取引先の追加ダイアログのキーワード、計画Issue #207)の単体テスト。
 * キーワード(取引先のパターン)1件の検証(空・重複。摘要に含まれなくても登録できる。計画Issue #236)、キーワードを含む明細の行数の数え方、
 * キーワードのどれか1つでも摘要に含まれるかの判定(ほかの行への適用)、新しいキーワードの科目の初期値(最も多い科目。同数は未設定)を確認する。
 * DB・DOM非依存の純粋関数のみを対象とし、外部依存はない。
 */
import { describe, expect, it } from 'vitest'
import { anyKeywordMatches, countRowsContaining, mostFrequentAccountId, validateKeyword } from './counterpartyKeywordModel'

describe('validateKeyword', () => {
  it('問題がなければnullを返す', () => {
    expect(validateKeyword({ text: '新聞販売店A', otherTexts: ['SHINBUN-A'] })).toBeNull()
  })

  it('空文字・空白だけなら「空」', () => {
    expect(validateKeyword({ text: '', otherTexts: [] })).toBe('empty')
    expect(validateKeyword({ text: '  　', otherTexts: [] })).toBe('empty')
  })

  it('正規化(全角半角・大文字小文字・空白)したときに他のキーワードと同じなら「重複」', () => {
    expect(validateKeyword({ text: 'shinbun-a', otherTexts: ['ＳＨＩＮＢＵＮ－Ａ'] })).toBe('duplicate')
    expect(validateKeyword({ text: '新聞 販売店A', otherTexts: ['新聞販売店a'] })).toBe('duplicate')
  })

  it('現在の明細の摘要に含まれない文字列でも、エラーにしない(計画Issue #236。含む行が0行になるだけ)', () => {
    expect(validateKeyword({ text: '日経新聞', otherTexts: [] })).toBeNull()
  })

  it('小書き文字・ひらがな/カタカナの違いだけの文字列は「重複」(計画Issue #236)', () => {
    expect(validateKeyword({ text: 'ジエイアール', otherTexts: ['ジェイアール'] })).toBe('duplicate')
    expect(validateKeyword({ text: 'じぇいあーる', otherTexts: ['ジェイアール'] })).toBe('duplicate')
  })

  it('空・重複、の順に判定する', () => {
    expect(validateKeyword({ text: '', otherTexts: [''] })).toBe('empty')
    expect(validateKeyword({ text: 'a', otherTexts: ['A'] })).toBe('duplicate')
  })
})

describe('mostFrequentAccountId', () => {
  it('最も多く使われている科目のidを返す', () => {
    expect(mostFrequentAccountId([10, 11, 10, null])).toBe(10)
  })

  it('科目が未設定(null)のものは数えない', () => {
    expect(mostFrequentAccountId([null, null, 11])).toBe(11)
  })

  it('件数が同数で並ぶときは、未設定(null)にする(計画Issue #236。結果を不安定に見せないため)', () => {
    expect(mostFrequentAccountId([10, 11])).toBeNull()
    expect(mostFrequentAccountId([10, 10, 11, 11, 12])).toBeNull()
  })

  it('1件も無い、または科目を持つものが無ければnull', () => {
    expect(mostFrequentAccountId([])).toBeNull()
    expect(mostFrequentAccountId([null, null])).toBeNull()
  })
})

describe('countRowsContaining', () => {
  const descriptions = ['ネット銀行 新聞販売店A 日経購読料', 'ネット銀行 新聞販売店A', '別の店B', 'カード スーパーC']

  it('キーワードを含む摘要の数を、正規化したうえで数える', () => {
    expect(countRowsContaining('新聞販売店a', descriptions)).toBe(2)
    expect(countRowsContaining('ネット銀行', descriptions)).toBe(2)
    expect(countRowsContaining('存在しない', descriptions)).toBe(0)
  })

  it('空のキーワードはどの摘要にも含まれないものとして数える', () => {
    expect(countRowsContaining('  ', descriptions)).toBe(0)
  })
})

describe('anyKeywordMatches', () => {
  it('キーワードのどれか1つでも摘要に含まれれば一致する(OR)', () => {
    expect(anyKeywordMatches(['日経', 'SHINBUN-A'], '日経購読料 引落')).toBe(true)
    expect(anyKeywordMatches(['日経', 'SHINBUN-A'], 'shinbun-a 3月')).toBe(true)
    expect(anyKeywordMatches(['日経', 'SHINBUN-A'], '別の店B')).toBe(false)
  })

  it('空のキーワードは無視し、キーワードが1件も無ければ一致しない', () => {
    expect(anyKeywordMatches(['', ' '], '別の店B')).toBe(false)
    expect(anyKeywordMatches([], '別の店B')).toBe(false)
  })
})
