/**
 * counterpartyKeywordModel(明細取込の「取引先の設定」・取引先の追加ダイアログのキーワード、計画Issue #207)の単体テスト。
 * キーワード(取引先のパターン)1件の検証(空・重複・新規は元の摘要に含まれる文字列のみ)、キーワードを含む明細の行数の数え方、
 * キーワードのどれか1つでも摘要に含まれるかの判定(ほかの行への適用)を確認する。
 * DB・DOM非依存の純粋関数のみを対象とし、外部依存はない。
 */
import { describe, expect, it } from 'vitest'
import { anyKeywordMatches, countRowsContaining, validateKeyword } from './counterpartyKeywordModel'

describe('validateKeyword', () => {
  it('問題がなければnullを返す', () => {
    expect(validateKeyword({ text: '新聞販売店A', otherTexts: ['SHINBUN-A'], sourceDescription: '新聞販売店A 3月分' })).toBeNull()
  })

  it('空文字・空白だけなら「空」', () => {
    expect(validateKeyword({ text: '', otherTexts: [], sourceDescription: null })).toBe('empty')
    expect(validateKeyword({ text: '  　', otherTexts: [], sourceDescription: null })).toBe('empty')
  })

  it('正規化(全角半角・大文字小文字・空白)したときに他のキーワードと同じなら「重複」', () => {
    expect(validateKeyword({ text: 'shinbun-a', otherTexts: ['ＳＨＩＮＢＵＮ－Ａ'], sourceDescription: null })).toBe('duplicate')
    expect(validateKeyword({ text: '新聞 販売店A', otherTexts: ['新聞販売店a'], sourceDescription: null })).toBe('duplicate')
  })

  it('元の摘要が指定されているとき、そこに含まれない文字列なら「摘要に含まれない」', () => {
    expect(validateKeyword({ text: '日経新聞', otherTexts: [], sourceDescription: '日経購読料' })).toBe('notInDescription')
  })

  it('元の摘要の一部なら、全角半角や空白の違いがあっても有効', () => {
    expect(validateKeyword({ text: '日経 ｺｳﾄﾞｸﾘｮｳ', otherTexts: [], sourceDescription: '内容:日経コウドクリョウ' })).toBeNull()
  })

  it('元の摘要がnull(登録済みの編集)なら、摘要に含まれるかは問わない', () => {
    expect(validateKeyword({ text: '今回の摘要に無い文字列', otherTexts: [], sourceDescription: null })).toBeNull()
  })

  it('空・重複・摘要に含まれない、の順に判定する', () => {
    expect(validateKeyword({ text: '', otherTexts: [''], sourceDescription: 'x' })).toBe('empty')
    expect(validateKeyword({ text: 'a', otherTexts: ['A'], sourceDescription: 'b' })).toBe('duplicate')
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
