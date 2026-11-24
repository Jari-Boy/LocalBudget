/**
 * formatDescriptionForDisplay(明細の摘要の表示用の標準化)のテスト。
 * 半角カナ・全角英数・全角空白などを揃えて、同じ意味の摘要が同じ見た目になることを検証する。
 * 照合用の正規化(normalizeDescriptionForMatching)と違い、大文字化と空白の除去はしない。外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { formatDescriptionForDisplay } from './formatDescriptionForDisplay'

describe('formatDescriptionForDisplay', () => {
  it('半角カナを全角カナにする(濁点・半濁点は1文字にまとめる)', () => {
    expect(formatDescriptionForDisplay('ｺｳｼﾞﾏﾁ ﾊﾟｰｸ')).toBe('コウジマチ パーク')
  })

  it('全角の英数字を半角にし、大文字小文字はそのまま残す', () => {
    expect(formatDescriptionForDisplay('Ｓｕｉｃａチャージ１０００')).toBe('Suicaチャージ1000')
  })

  it('全角空白と連続する空白を1つの半角空白にまとめ、前後の空白は取り除く', () => {
    expect(formatDescriptionForDisplay('　モバイル　　Suica  ')).toBe('モバイル Suica')
  })

  it('すでに標準化された摘要はそのまま返す', () => {
    expect(formatDescriptionForDisplay('スーパー 新宿店')).toBe('スーパー 新宿店')
  })

  it('カタカナにつづくハイフン・ダッシュ類(半角・全角・長音に似た記号)を、長音「ー」にそろえる', () => {
    expect(formatDescriptionForDisplay('ﾌｧﾐﾘ-ﾏ-ﾄ')).toBe('ファミリーマート')
    expect(formatDescriptionForDisplay('ファミリ－マ－ト')).toBe('ファミリーマート')
    expect(formatDescriptionForDisplay('ファミリ‐マ−ト')).toBe('ファミリーマート')
  })

  it('「かな+空白+分離した濁点」(U+309B / U+3099 / U+FF9E)を、1文字の濁点つきの文字にする(計画Issue #279)', () => {
    expect(formatDescriptionForDisplay('ワイシ ゛エイカート ゛(カ')).toBe('ワイジエイカード(カ')
    expect(formatDescriptionForDisplay('ワイシ ゙エイカート ゙(カ')).toBe('ワイジエイカード(カ')
    expect(formatDescriptionForDisplay('ワイシ ﾞエイカート ﾞ(カ')).toBe('ワイジエイカード(カ')
  })

  it('半濁点(U+309C / U+309A / U+FF9F)も、空白をはさんでいても1文字にする', () => {
    expect(formatDescriptionForDisplay('ハ ゜')).toBe('パ')
    expect(formatDescriptionForDisplay('ハ ゚')).toBe('パ')
    expect(formatDescriptionForDisplay('ハ ﾟ')).toBe('パ')
  })

  it('濁点と無関係な空白は、従来どおり1つにまとめるだけで詰めない', () => {
    expect(formatDescriptionForDisplay('abc  def ガス  ホーム')).toBe('abc def ガス ホーム')
  })

  it('カタカナにつづかないハイフン(電話番号・日付・英数字)は、ハイフンのまま残す', () => {
    expect(formatDescriptionForDisplay('ABC-123 03-1234-5678')).toBe('ABC-123 03-1234-5678')
    expect(formatDescriptionForDisplay('カード 2026-10-05')).toBe('カード 2026-10-05')
  })
})
