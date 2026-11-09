/**
 * resolveSettlementTarget(精算タブで、選んだバッチ・方向の「対象者」と、比べる残高を決める純粋関数、
 * 計画Issue #153)のユニットテスト。バッチが世帯内でも世帯外の相手でも、対象者は残高が残っている
 * 世帯メンバー(残高は「科目×世帯メンバー」で持ち、バッチはイベントをまとめるだけ)で、そのメンバーの
 * 残高と比べることを検証する。すべての行に世帯メンバーが入る前提(制約の実装は別Issue)。DB非依存の純粋関数。
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
  it('世帯外の相手のバッチも、対象者は残高が残っている世帯メンバーで、そのメンバーの残高と比べる', () => {
    const b = batch(9)
    const s = summary(b, direction('advance', [{ householdMemberId: 1, balance: 12000 }]), direction('payable', []))

    expect(resolveSettlementTarget(s, 'advance')).toEqual({
      target: { kind: 'householdMember', householdMemberId: 1 },
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

    expect(resolveSettlementTarget(s, 'advance')).toEqual({
      target: { kind: 'householdMember', householdMemberId: 2 },
      balance: 6000,
    })
  })

  it('その方向に明細が無ければ、もう一方の方向の世帯メンバーを対象者にして残高は0にする', () => {
    const b = batch(null)
    const s = summary(b, direction('advance', [{ householdMemberId: 2, balance: 6000 }]), direction('payable', []))

    expect(resolveSettlementTarget(s, 'payable')).toEqual({
      target: { kind: 'householdMember', householdMemberId: 2 },
      balance: 0,
    })
  })

  it('世帯メンバーを特定できないバッチ(明細なし)は、対象者がnullになる', () => {
    const b = batch(null)
    const s = summary(b, direction('advance', []), direction('payable', []))

    expect(resolveSettlementTarget(s, 'advance')).toEqual({ target: null, balance: 0 })
  })
})
