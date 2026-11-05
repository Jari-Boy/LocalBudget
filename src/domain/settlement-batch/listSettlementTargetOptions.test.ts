/**
 * listSettlementTargetOptions(精算画面の「対象者」ドロップダウンの候補一覧を組み立てる純粋関数、
 * 計画Issue #139)のユニットテスト。世帯メンバーは立替金/未払金(is_system_managedの資産・負債)
 * 科目の明細行からhousehold_member_idを収集し、取引先はsettlement_batches.counterparty_idから
 * 収集することを検証する(docs/domain/settlement.md)。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import type { HouseholdMember } from '../household-member/HouseholdMember'
import type { Counterparty } from '../counterparty/Counterparty'
import { listSettlementTargetOptions } from './listSettlementTargetOptions'

function line(overrides: Partial<JournalLine>): JournalLine {
  return {
    id: 1,
    journalEntryId: 1,
    accountId: 1,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    settlementBatchId: null,
    side: 'debit',
    amount: 1000,
    createdAt: '2026-08-01',
    ...overrides,
  }
}

function member(id: number, name: string): HouseholdMember {
  return { id, name, isGroup: false, isActive: true, createdAt: '2026-08-01', updatedAt: '2026-08-01' }
}

function counterparty(id: number, name: string): Counterparty {
  return { id, name, defaultAccountId: null, isActive: true, createdAt: '2026-08-01', updatedAt: '2026-08-01' }
}

function batch(id: number, name: string, counterpartyId: number | null): SettlementBatch {
  return { id, name, type: 'expense_splitting', counterpartyId, createdAt: '2026-08-01', updatedAt: '2026-08-01' }
}

describe('listSettlementTargetOptions', () => {
  it('立替金/未払金科目の明細行に現れる世帯メンバーを候補として返す', () => {
    const memberA = member(1, 'Aさん')
    const memberB = member(2, 'Bさん')
    const lines = [
      line({ accountId: 10, householdMemberId: memberA.id }),
      line({ accountId: 11, householdMemberId: memberB.id }),
    ]

    const result = listSettlementTargetOptions(lines, [], [memberA, memberB], [], [10, 11])

    expect(result).toEqual([
      { kind: 'householdMember', id: memberA.id, name: memberA.name },
      { kind: 'householdMember', id: memberB.id, name: memberB.name },
    ])
  })

  it('立替金/未払金以外の科目の明細行にしか現れない世帯メンバーは候補に含めない', () => {
    const memberA = member(1, 'Aさん')
    const lines = [line({ accountId: 99, householdMemberId: memberA.id })]

    const result = listSettlementTargetOptions(lines, [], [memberA], [], [10, 11])

    expect(result).toEqual([])
  })

  it('counterparty_idが設定された精算バッチに対応する取引先を候補として返す', () => {
    const counterpartyA = counterparty(1, 'イオン')
    const batches = [batch(100, 'イオンの後払い分', counterpartyA.id)]

    const result = listSettlementTargetOptions([], batches, [], [counterpartyA], [10, 11])

    expect(result).toEqual([{ kind: 'counterparty', id: counterpartyA.id, name: counterpartyA.name }])
  })

  it('counterparty_idがnullの精算バッチ(世帯メンバー間)は取引先候補を生成しない', () => {
    const batches = [batch(100, '世帯内バッチ', null)]

    const result = listSettlementTargetOptions([], batches, [], [], [10, 11])

    expect(result).toEqual([])
  })

  it('同じ世帯メンバー・取引先が複数行/複数バッチに現れても重複なく1件にまとめる', () => {
    const memberA = member(1, 'Aさん')
    const counterpartyA = counterparty(1, 'イオン')
    const lines = [
      line({ accountId: 10, householdMemberId: memberA.id }),
      line({ accountId: 11, householdMemberId: memberA.id }),
    ]
    const batches = [
      batch(100, 'バッチ1', counterpartyA.id),
      batch(101, 'バッチ2', counterpartyA.id),
    ]

    const result = listSettlementTargetOptions(lines, batches, [memberA], [counterpartyA], [10, 11])

    expect(result).toEqual([
      { kind: 'householdMember', id: memberA.id, name: memberA.name },
      { kind: 'counterparty', id: counterpartyA.id, name: counterpartyA.name },
    ])
  })
})
