/**
 * estimateCounterparty(取引先推定、docs/domain/statement-import.md 1.5 手順4・
 * docs/domain/counterparties.md 1.3)の純粋関数寄りのユニットテスト。
 * CSVの摘要文字列を正規化(全角半角統一・大文字小文字統一・空白除去)し、
 * CounterpartyRepository.findByPattern(A2、既存実装)の部分一致結果からマッチが1件(取引先が
 * 一意)なら自動採用、0件または複数取引先にまたがる場合は自動確定しないことを検証する。
 * DBには依存せず、findByPatternをスタブ化したフェイクリポジトリで検証する。
 */
import { describe, expect, it } from 'vitest'
import type { CounterpartyPattern } from '../counterparty/Counterparty'
import { estimateCounterparty, normalizeDescriptionForMatching } from './estimateCounterparty'

function fakeRepository(patterns: CounterpartyPattern[]) {
  return {
    findByPattern(text: string): CounterpartyPattern[] {
      return patterns.filter((p) => text.includes(p.pattern))
    },
  }
}

describe('normalizeDescriptionForMatching', () => {
  it('全角英数字を半角に統一する', () => {
    expect(normalizeDescriptionForMatching('ＡＭＡＺＯＮ')).toBe('AMAZON')
  })

  it('大文字小文字を統一する', () => {
    expect(normalizeDescriptionForMatching('Amazon.co.jp')).toBe('AMAZON.CO.JP')
  })

  it('空白(半角・全角)を除去する', () => {
    expect(normalizeDescriptionForMatching('セブン イレブン　日本橋店')).toBe('セブンイレブン日本橋店')
  })
})

describe('estimateCounterparty', () => {
  it('マッチが1件のみの場合はその取引先IDを返す', () => {
    const repo = fakeRepository([
      { id: 1, counterpartyId: 10, pattern: 'AMAZON', createdAt: '2026-01-01' },
    ])

    const result = estimateCounterparty('AMAZON.CO.JP東京', repo)

    expect(result).toBe(10)
  })

  it('マッチが0件の場合はnullを返す(自動確定しない)', () => {
    const repo = fakeRepository([])

    const result = estimateCounterparty('未知の店舗', repo)

    expect(result).toBeNull()
  })

  it('複数の取引先にまたがってマッチする場合(曖昧)はnullを返す', () => {
    const repo = fakeRepository([
      { id: 1, counterpartyId: 10, pattern: 'セブン', createdAt: '2026-01-01' },
      { id: 2, counterpartyId: 20, pattern: 'イレブン', createdAt: '2026-01-01' },
    ])

    const result = estimateCounterparty('セブンイレブン日本橋店', repo)

    expect(result).toBeNull()
  })

  it('同一取引先に紐づく複数パターンがマッチしても曖昧とはみなさず一意に採用する', () => {
    const repo = fakeRepository([
      { id: 1, counterpartyId: 10, pattern: 'セブン', createdAt: '2026-01-01' },
      { id: 2, counterpartyId: 10, pattern: 'イレブン', createdAt: '2026-01-01' },
    ])

    const result = estimateCounterparty('セブンイレブン日本橋店', repo)

    expect(result).toBe(10)
  })

  it('マッチング前に摘要を正規化してから照合する(全角/大文字小文字の表記ゆれを吸収)', () => {
    const repo = fakeRepository([
      { id: 1, counterpartyId: 10, pattern: 'AMAZON', createdAt: '2026-01-01' },
    ])

    const result = estimateCounterparty('ａｍａｚｏｎ．ｃｏ．ｊｐ', repo)

    expect(result).toBe(10)
  })
})
