/**
 * domainErrorRegistry のユニットテスト。
 * Comlinkのpostmessage(構造化複製)ではカスタムErrorサブクラスのプロトタイプチェーンが
 * 失われるため、RPC越しでも呼び出し元がinstanceof判定できるよう、ドメインエラーを
 * name/message/追加プロパティ(extra)へ分解・復元する純粋関数を検証する。
 * 外部依存なし(ドメインエラークラスのみに依存する純粋なTypeScript)。
 */
import { describe, expect, it } from 'vitest'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'
import { NoBalanceDiscrepancyError } from '../../domain/reconciliation/NoBalanceDiscrepancyError'
import { InvalidRecurringScheduleError } from '../../domain/recurring-transaction/InvalidRecurringScheduleError'
import { MappingColumnNotFoundError } from '../../domain/statement-import/MappingColumnNotFoundError'
import {
  deserializeDomainError,
  isDomainError,
  serializeDomainError,
} from './domainErrorRegistry'

describe('isDomainError', () => {
  it('登録済みの6種のドメインエラーをtrueと判定する', () => {
    expect(isDomainError(new UnbalancedJournalEntryError(100, 90))).toBe(true)
    expect(isDomainError(new RestrictedAccountPostingError(1, 'manual'))).toBe(true)
    expect(isDomainError(new SettlementTagMismatchError(1, 2))).toBe(true)
    expect(isDomainError(new NoBalanceDiscrepancyError())).toBe(true)
    expect(isDomainError(new InvalidRecurringScheduleError('invalid'))).toBe(true)
    expect(isDomainError(new MappingColumnNotFoundError('date', 'A'))).toBe(true)
  })

  it('登録されていない通常のErrorはfalseと判定する', () => {
    expect(isDomainError(new Error('plain'))).toBe(false)
  })

  it('Errorではない値はfalseと判定する', () => {
    expect(isDomainError('not an error')).toBe(false)
    expect(isDomainError(null)).toBe(false)
    expect(isDomainError(undefined)).toBe(false)
  })
})

describe('serializeDomainError / deserializeDomainError', () => {
  it('UnbalancedJournalEntryErrorのdebitTotal/creditTotalを保持して往復する', () => {
    const original = new UnbalancedJournalEntryError(1000, 900)

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(UnbalancedJournalEntryError)
    expect(revived.message).toBe(original.message)
    expect((revived as UnbalancedJournalEntryError).debitTotal).toBe(1000)
    expect((revived as UnbalancedJournalEntryError).creditTotal).toBe(900)
  })

  it('UnbalancedJournalEntryErrorの明細数不足メッセージも保持して往復する', () => {
    const original = new UnbalancedJournalEntryError(0, 0, 'at least 2 lines are required')

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived.message).toBe('at least 2 lines are required')
  })

  it('RestrictedAccountPostingErrorのaccountId/sourceTypeを保持して往復する', () => {
    const original = new RestrictedAccountPostingError(42, 'manual')

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(RestrictedAccountPostingError)
    expect((revived as RestrictedAccountPostingError).accountId).toBe(42)
    expect((revived as RestrictedAccountPostingError).sourceType).toBe('manual')
  })

  it('SettlementTagMismatchErrorのfromEntryId/toEntryIdを保持して往復する', () => {
    const original = new SettlementTagMismatchError(10, 20)

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(SettlementTagMismatchError)
    expect((revived as SettlementTagMismatchError).fromEntryId).toBe(10)
    expect((revived as SettlementTagMismatchError).toEntryId).toBe(20)
  })

  it('NoBalanceDiscrepancyErrorを往復する', () => {
    const original = new NoBalanceDiscrepancyError()

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(NoBalanceDiscrepancyError)
    expect(revived.message).toBe(original.message)
  })

  it('InvalidRecurringScheduleErrorのmessageを保持して往復する', () => {
    const original = new InvalidRecurringScheduleError('monthly requires day_of_month')

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(InvalidRecurringScheduleError)
    expect(revived.message).toBe('monthly requires day_of_month')
  })

  it('MappingColumnNotFoundErrorのfieldName/columnSpecを保持して往復する', () => {
    const original = new MappingColumnNotFoundError('entry_date', '日付')

    const revived = deserializeDomainError(serializeDomainError(original))

    expect(revived).toBeInstanceOf(MappingColumnNotFoundError)
    expect((revived as MappingColumnNotFoundError).fieldName).toBe('entry_date')
    expect((revived as MappingColumnNotFoundError).columnSpec).toBe('日付')
  })

  it('未登録のエラー名をdeserializeしようとした場合は例外を投げる', () => {
    expect(() =>
      deserializeDomainError({ name: 'UnknownError', message: 'x', extra: {} }),
    ).toThrow()
  })
})
