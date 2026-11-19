/**
 * normalizeForSearch / matchesSearch(選択欄の検索用の正規化)のテスト。
 * ひらがな・カタカナ・半角カナ・全角半角・英字の大小・空白・長音の違いを区別せずに比べられることを検証する。
 * 漢字は変換せずそのまま比較する(読み仮名検索は対象外)。取込の摘要照合(normalizeDescriptionForMatching)とは別の関数。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { matchesSearch, normalizeForSearch } from './normalizeForSearch'

describe('normalizeForSearch', () => {
  it('ひらがなとカタカナを同じ文字列にそろえる', () => {
    expect(normalizeForSearch('さんどらっぐ')).toBe(normalizeForSearch('サンドラッグ'))
  })

  it('濁点・半濁点・小書き文字(ゃゅょっ)を含んでもそろえられる', () => {
    expect(normalizeForSearch('ぎゃっぷ')).toBe(normalizeForSearch('ギャップ'))
    expect(normalizeForSearch('ぱぴぷ')).toBe(normalizeForSearch('パピプ'))
  })

  it('半角カナ(濁点つき含む)を全角のひらがな相当にそろえる', () => {
    expect(normalizeForSearch('ｻﾝﾄﾞﾗｯｸﾞ')).toBe(normalizeForSearch('さんどらっぐ'))
  })

  it('長音「ー」を保ち、半角の長音・ハイフン類もそろえる', () => {
    expect(normalizeForSearch('コーヒー')).toBe(normalizeForSearch('こーひー'))
    expect(normalizeForSearch('ｺｰﾋｰ')).toBe(normalizeForSearch('こーひー'))
  })

  it('全角英数を半角にし、英字の大文字・小文字を区別しない', () => {
    expect(normalizeForSearch('ＡＢｃ１２')).toBe('abc12')
  })

  it('空白(全角含む)を取り除く', () => {
    expect(normalizeForSearch(' ド ラッグ　ストア ')).toBe(normalizeForSearch('どらっぐすとあ'))
  })

  it('漢字は変換せずそのまま残す', () => {
    expect(normalizeForSearch('食費')).toBe('食費')
    expect(normalizeForSearch('しょくひ')).not.toBe(normalizeForSearch('食費'))
  })

  it('空文字は空文字のまま', () => {
    expect(normalizeForSearch('')).toBe('')
  })
})

describe('matchesSearch', () => {
  it('ひらがなの検索語でカタカナの名前にヒットする(逆も同様)', () => {
    expect(matchesSearch('サンドラッグ新宿店', 'さんどらっぐ')).toBe(true)
    expect(matchesSearch('さんどらっぐ', 'サンドラッグ')).toBe(true)
  })

  it('部分一致でヒットし、含まない語はヒットしない', () => {
    expect(matchesSearch('ドラッグストア', 'らっぐ')).toBe(true)
    expect(matchesSearch('ドラッグストア', 'こんびに')).toBe(false)
  })

  it('検索語が空(空白のみ含む)なら常にヒットする', () => {
    expect(matchesSearch('食費', '')).toBe(true)
    expect(matchesSearch('食費', '  ')).toBe(true)
  })
})
