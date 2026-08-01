import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'
import { NoBalanceDiscrepancyError } from '../../domain/reconciliation/NoBalanceDiscrepancyError'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'
import { MappingColumnNotFoundError } from '../../domain/statement-import/MappingColumnNotFoundError'

export interface SerializedDomainError {
  name: string
  message: string
  extra: Record<string, unknown>
}

type DomainErrorReviver = (message: string, extra: Record<string, unknown>) => Error

/**
 * ドメインエラーのname(docs/decisions.md「エラー型の使い分け基準」で列挙された6種)から、
 * 元のコンストラクタ引数を復元するレジストリ。新しいドメインエラー型を追加する際は
 * ここに1エントリ追加するだけでよい(RPC層のレジストリパターンと同じ思想)。
 */
const DOMAIN_ERROR_REVIVERS: Record<string, DomainErrorReviver> = {
  UnbalancedJournalEntryError: (message, extra) =>
    new UnbalancedJournalEntryError(
      extra.debitTotal as number,
      extra.creditTotal as number,
      message,
    ),
  RestrictedAccountPostingError: (_message, extra) =>
    new RestrictedAccountPostingError(extra.accountId as number, extra.sourceType as string),
  SettlementTagMismatchError: (_message, extra) =>
    new SettlementTagMismatchError(extra.fromEntryId as number, extra.toEntryId as number),
  NoBalanceDiscrepancyError: () => new NoBalanceDiscrepancyError(),
  InvalidRecurringScheduleError: (message) => new InvalidRecurringScheduleError(message),
  MappingColumnNotFoundError: (_message, extra) =>
    new MappingColumnNotFoundError(extra.fieldName as string, extra.columnSpec as string),
}

const NON_EXTRA_KEYS = new Set(['name'])

export function isDomainError(value: unknown): value is Error {
  return value instanceof Error && value.name in DOMAIN_ERROR_REVIVERS
}

/**
 * ドメインエラーをname/message/追加プロパティ(extra)に分解する。extraはコンストラクタで
 * 設定されたown enumerableプロパティ(debitTotal等)から、name(別途保持)を除いたもの。
 * messageはError標準のnon-enumerableプロパティのためObject.keysには含まれない。
 */
export function serializeDomainError(error: Error): SerializedDomainError {
  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(error)) {
    if (!NON_EXTRA_KEYS.has(key)) {
      extra[key] = (error as unknown as Record<string, unknown>)[key]
    }
  }
  return { name: error.name, message: error.message, extra }
}

export function deserializeDomainError(serialized: SerializedDomainError): Error {
  const revive = DOMAIN_ERROR_REVIVERS[serialized.name]
  if (!revive) {
    throw new Error(`unknown domain error: ${serialized.name}`)
  }
  return revive(serialized.message, serialized.extra)
}
