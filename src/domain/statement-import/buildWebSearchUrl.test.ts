/**
 * buildWebSearchUrl(明細取込画面の摘要のウェブ検索リンク、計画Issue #283)のテスト。
 * 摘要の文字列から、Googleの検索ページのURLを作る純粋関数であることを検証する。
 * 日本語・記号・空白・URLの予約文字を含む摘要が正しくエンコードされ、検索語がクエリ文字列を壊さないことを確認する。
 * 外部依存なし(ネットワークには接続しない。URLを作るだけで、開くのは画面側のリンク)。
 */
import { describe, expect, it } from 'vitest'
import { buildWebSearchUrl } from './buildWebSearchUrl'

/** 作ったURLから検索語(q)を取り出して、エンコードを元に戻せることで確認する */
const queryOf = (url: string) => new URL(url).searchParams.get('q')

describe('buildWebSearchUrl', () => {
  it('GoogleのHTTPSの検索ページを指す', () => {
    const url = new URL(buildWebSearchUrl('スーパー'))
    expect(url.origin).toBe('https://www.google.com')
    expect(url.pathname).toBe('/search')
  })

  it('日本語の摘要は、URLエンコードして検索語(q)に入る', () => {
    const url = buildWebSearchUrl('フルーツパーラー フエルナ')
    expect(url).toContain(encodeURIComponent('フルーツパーラー'))
    expect(queryOf(url)).toBe('フルーツパーラー フエルナ')
  })

  it('記号・半角カッコ・全角カッコを含む摘要も、そのまま検索語に戻せる', () => {
    expect(queryOf(buildWebSearchUrl('カ)マーチカンパニー'))).toBe('カ)マーチカンパニー')
    expect(queryOf(buildWebSearchUrl('(株)テスト・ショップ'))).toBe('(株)テスト・ショップ')
  })

  it('&・=・#・%・+ などURLの予約文字を含んでも、検索語の外へ漏れない(他のパラメータを足せない)', () => {
    const url = buildWebSearchUrl('A&B=C#D%E+F&q=evil')
    const params = new URL(url).searchParams
    expect(params.get('q')).toBe('A&B=C#D%E+F&q=evil')
    expect([...params.keys()]).toEqual(['q'])
    expect(new URL(url).hash).toBe('')
  })

  it('前後の空白は取り除く', () => {
    expect(queryOf(buildWebSearchUrl('  FAMILY CLUB web  '))).toBe('FAMILY CLUB web')
  })
})
