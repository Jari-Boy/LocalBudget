/**
 * normalizeDescriptionForMatching(摘要とキーワードの照合用の正規化)のテスト。
 * 全角半角の統一(NFKC)・大文字化・空白除去を検証する(docs/domain/counterparties.md 1.3 手順1)。
 * 外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { normalizeDescriptionForMatching } from './estimateCounterparty'

describe('normalizeDescriptionForMatching', () => {
  it('全角を半角にそろえ、小文字を大文字にし、空白(全角含む)を取り除く', () => {
    expect(normalizeDescriptionForMatching('ａｍａｚｏｎ．ｃｏ．ｊｐ 東京')).toBe('AMAZON.CO.JP東京')
  })

  it('カタカナにつづくハイフン類は長音にそろえ、表記ゆれ(半角カナ・ハイフン)があっても同じ文字列になる', () => {
    expect(normalizeDescriptionForMatching('ﾌｧﾐﾘ-ﾏ-ﾄ')).toBe('ファミリーマート')
    expect(normalizeDescriptionForMatching('ファミリ－マ－ト')).toBe('ファミリーマート')
  })

  it('カタカナにつづかないハイフンは残す', () => {
    expect(normalizeDescriptionForMatching('abc-123')).toBe('ABC-123')
  })
})
