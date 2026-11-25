/**
 * normalizeDescriptionForMatching(摘要とキーワードの照合用の正規化)のテスト。
 * 全角半角の統一(NFKC)・大文字化・空白除去と、ひらがな/カタカナ・小書き文字の区別をしないこと(計画Issue #236)を検証する
 * (docs/domain/counterparties.md 1.3 手順1)。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { normalizeDescriptionForMatching } from './estimateCounterparty'

describe('normalizeDescriptionForMatching', () => {
  it('全角を半角にそろえ、小文字を大文字にし、空白(全角含む)を取り除く', () => {
    expect(normalizeDescriptionForMatching('ａｍａｚｏｎ．ｃｏ．ｊｐ 東京')).toBe('AMAZON.CO.JP東京')
  })

  it('カタカナにつづくハイフン類は長音にそろえ、表記ゆれ(半角カナ・ハイフン)があっても同じ文字列になる', () => {
    // 小書き文字は大きい文字にそろう(ファ → フア)ので、期待値はフアミリーマート
    expect(normalizeDescriptionForMatching('ﾌｧﾐﾘ-ﾏ-ﾄ')).toBe('フアミリーマート')
    expect(normalizeDescriptionForMatching('ファミリ－マ－ト')).toBe('フアミリーマート')
  })

  it('カタカナにつづかないハイフンは残す', () => {
    expect(normalizeDescriptionForMatching('abc-123')).toBe('ABC-123')
  })

  it('カタカナの小書き文字(ェ・ャ・ッ など)を大きい文字にそろえ、ジェイアールとジエイアールが同じになる', () => {
    expect(normalizeDescriptionForMatching('ジェイアール')).toBe(normalizeDescriptionForMatching('ジエイアール'))
    expect(normalizeDescriptionForMatching('スイカチャージ')).toBe(normalizeDescriptionForMatching('スイカチヤージ'))
    expect(normalizeDescriptionForMatching('ローソンストアッ')).toBe(normalizeDescriptionForMatching('ローソンストアツ'))
  })

  it('ひらがなをカタカナにそろえ、ひらがなの小書き文字も大きい文字にそろえる', () => {
    expect(normalizeDescriptionForMatching('じぇいあーる')).toBe(normalizeDescriptionForMatching('ジエイアール'))
    expect(normalizeDescriptionForMatching('じえいあーる')).toBe(normalizeDescriptionForMatching('ジェイアール'))
  })

  it('半角カナの小書き文字(ｪ・ｬ)も大きい文字と同じになる', () => {
    expect(normalizeDescriptionForMatching('ｼﾞｪｲｱｰﾙ')).toBe(normalizeDescriptionForMatching('ジエイアール'))
  })

  it('ヵ・ヶ・ゕ・ゖ も カ・ケ にそろう', () => {
    expect(normalizeDescriptionForMatching('一ヶ月')).toBe(normalizeDescriptionForMatching('一ケ月'))
    expect(normalizeDescriptionForMatching('ゕゖ')).toBe('カケ')
  })

  it('「かな+空白+分離した濁点」(U+309B / U+3099 / U+FF9E)が、1文字の濁点つきの文字と同じになる(計画Issue #279)', () => {
    const expected = normalizeDescriptionForMatching('ワイジェイカード')
    expect(normalizeDescriptionForMatching('ワイシ ゛エイカート ゛(カ')).toBe(`${expected}(カ`)
    expect(normalizeDescriptionForMatching('ワイシ ゙エイカート ゙(カ')).toBe(`${expected}(カ`)
    expect(normalizeDescriptionForMatching('ワイシ ﾞエイカート ﾞ(カ')).toBe(`${expected}(カ`)
  })

  it('空白のない「かな+濁点」は従来どおり1文字にそろう', () => {
    expect(normalizeDescriptionForMatching('ジ')).toBe('ジ')
    expect(normalizeDescriptionForMatching('ｼﾞ')).toBe('ジ')
  })

  it('半濁点(U+309C / U+309A / U+FF9F)も、空白をはさんでいても1文字にそろう', () => {
    expect(normalizeDescriptionForMatching('ハ ゜')).toBe('パ')
    expect(normalizeDescriptionForMatching('ハ ゚')).toBe('パ')
    expect(normalizeDescriptionForMatching('ハ ﾟ')).toBe('パ')
  })

  it('濁点と無関係な空白(英単語の後ろなど)は、従来どおり取り除かれるだけ', () => {
    expect(normalizeDescriptionForMatching('abc def ガス')).toBe('ABCDEFガス')
  })

  it('漢字・英数字・長音は変えない', () => {
    expect(normalizeDescriptionForMatching('東京 abc-1')).toBe('東京ABC-1')
    expect(normalizeDescriptionForMatching('コーヒー')).toBe('コーヒー')
  })

  it('分離した濁点のあとのハイフンも長音にそろい、「ｳﾗｺｳﾗｸ ﾞﾋ ﾞ-ﾌ ﾞ」が「ウラコウラグビ-ブ」(キーワードの初期値)と一致する(計画Issue #291)', () => {
    const expected = normalizeDescriptionForMatching('ウラコウラグビーブ')
    expect(normalizeDescriptionForMatching('ｳﾗｺｳﾗｸ ﾞﾋ ﾞ-ﾌ ﾞ')).toBe(expected)
    expect(normalizeDescriptionForMatching('ウラコウラク ゛ヒ ゛-フ ゛')).toBe(expected)
    // 画面に出す初期値(ハイフンのまま)を正規化しても、同じ文字列になる
    expect(normalizeDescriptionForMatching('ウラコウラグビ-ブ')).toBe(expected)
  })
})
