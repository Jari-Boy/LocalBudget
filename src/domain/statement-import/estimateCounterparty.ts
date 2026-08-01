import type { CounterpartyPattern } from '../counterparty/Counterparty'

/**
 * CSV摘要文字列とcounterparty_patternsのマッチング用に正規化する
 * (docs/domain/counterparties.md 1.3 手順1: 全角半角統一・大文字小文字統一・空白除去)。
 */
export function normalizeDescriptionForMatching(text: string): string {
  return text.normalize('NFKC').toUpperCase().replace(/\s+/g, '')
}

/**
 * findByPatternが返すCounterpartyPattern[]のみを必要とする、CounterpartyRepositoryの部分依存。
 */
export interface CounterpartyPatternLookup {
  findByPattern(text: string): CounterpartyPattern[]
}

/**
 * 取引先推定(docs/domain/statement-import.md 1.5 手順4・docs/domain/counterparties.md 1.3)。
 * 摘要を正規化してCounterpartyRepository.findByPattern(A2、既存実装)へ渡し、部分一致するパターンを
 * 検索する。マッチが一意の取引先に絞られれば(同一取引先の複数パターンがマッチしてもよい)その
 * counterpartyIdを返し、マッチが0件または複数取引先にまたがる場合(曖昧)はnullを返して
 * レビュー画面でのユーザー選択に委ねる。
 */
export function estimateCounterparty(
  description: string,
  repository: CounterpartyPatternLookup,
): number | null {
  const normalized = normalizeDescriptionForMatching(description)
  const matches = repository.findByPattern(normalized)
  const uniqueCounterpartyIds = [...new Set(matches.map((match) => match.counterpartyId))]
  return uniqueCounterpartyIds.length === 1 ? uniqueCounterpartyIds[0] : null
}
