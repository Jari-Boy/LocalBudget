/**
 * resolveSettlementTarget(精算タブで、選んだバッチ・方向の「対象者」と、比べる残高を決める純粋関数、
 * 計画Issue #153)のユニットテスト。世帯外の相手(取引先)のバッチは取引先を対象者にして方向全体の
 * 残高と比べ、世帯内のバッチは残高が残っている世帯メンバーを対象者にしてそのメンバーの残高と比べる
 * ことを検証する。DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { SettlementBatch } from './SettlementBatch'
import type { SettlementBatchSummary, SettlementDirectionSummary } from './summarizeSettlementBatch'
import { resolveSettlementTarget } from './resolveSettlementTarget'

function batch(counterpartyId: number | null): SettlementBatch {
  return { id: 1, name: 'バッチ', type: 'expense_splitting', counterpartyId, createdAt: '', updatedAt: '' }
}

function direction(
  d: 'advance' | 'payable',
  breakdown: { householdMemberId: number | null; balance: number }[],
): SettlementDirectionSummary {
  return {
    direction: d,
    accountId: d === 'advance' ? 10 : 20,
    hasLines: breakdown.length > 0,
    balance: breakdown.reduce((sum, b) => sum + b.balance, 0),
    breakdown,
  }
}

function summary(
  b: SettlementBatch,
  advance: SettlementDirectionSummary,
  payable: SettlementDirectionSummary,
): SettlementBatchSummary {
  return { batch: b, advance, payable, hasLines: advance.hasLines || payable.hasLines, isSettled: false }
}

describe('resolveSettlementTarget', () => {
  it('世帯外の相手のバッチは、取引先を対象者にして方向全体の残高と比べる', () => {
    const b = batch(9)
    const s = summary(b, direction('advance', [{ householdMemberId: 1, balance: 12000 }]), direction('payable', []))

    expect(resolveSettlementTarget(b, s, 'advance')).toEqual({
      target: { kind: 'counterparty', counterpartyId: 9 },
      balance: 12000,
    })
  })

  it('世帯内のバッチは、残高が残っている世帯メンバーを対象者にして、そのメンバーの残高と比べる', () => {
    const b = batch(null)
    const s = summary(
      b,
      direction('advance', [
        { householdMemberId: 1, balance: 0 },
        { householdMemberId: 2, balance: 6000 },
      ]),
      direction('payable', []),
    )

    expect(resolveSettlementTarget(b, s, 'advance')).toEqual({
      target: { kind: 'householdMember', householdMemberId: 2 },
      balance: 6000,
    })
  })

  it('その方向に明細が無ければ、もう一方の方向の世帯メンバーを対象者にして残高は0にする', () => {
    const b = batch(null)
    const s = summary(b, direction('advance', [{ householdMemberId: 2, balance: 6000 }]), direction('payable', []))

    expect(resolveSettlementTarget(b, s, 'payable')).toEqual({
      target: { kind: 'householdMember', householdMemberId: 2 },
      balance: 0,
    })
  })

  it('世帯メンバーを特定できないバッチ(明細なし)は、対象者がnullになる', () => {
    const b = batch(null)
    const s = summary(b, direction('advance', []), direction('payable', []))

    expect(resolveSettlementTarget(b, s, 'advance')).toEqual({ target: null, balance: 0 })
  })
})
