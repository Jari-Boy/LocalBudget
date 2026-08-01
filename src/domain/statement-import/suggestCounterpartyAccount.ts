import type { Counterparty } from '../counterparty/Counterparty'

/**
 * findByIdのみを必要とする、CounterpartyRepositoryの部分依存。
 */
export interface CounterpartyLookup {
  findById(id: number): Counterparty | null
}

/**
 * 相手勘定科目サジェスト(docs/domain/statement-import.md 1.5 手順5-b、1.7スコープ)。
 * MVPスコープは取引先経由のサジェストのみ。未消込の未払金・未収金消込サジェスト(手順5-a、
 * settlement.mdドメイン)は対象外(別Issue)。取引先が一意に特定できていない、または
 * 取引先にdefaultAccountIdが未設定の場合はnullを返し、ユーザーの手動選択に委ねる。
 */
export function suggestCounterpartyAccount(
  counterpartyId: number | null,
  repository: CounterpartyLookup,
): number | null {
  if (counterpartyId === null) return null
  const counterparty = repository.findById(counterpartyId)
  return counterparty?.defaultAccountId ?? null
}
