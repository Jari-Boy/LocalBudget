/**
 * copySettlementTag(タグ付き一時勘定の消込時タグコピー)の純粋関数としてのユニットテスト。
 * docs/domain/settlement.md 1.7の「確定した(to_entry, amount)の組に対応する消込仕訳側の
 * 一時勘定行のタグ(project_id/household_member_id)を、to_entry側の対応行から機械的にコピーする」
 * ルールを、タグなし・1:N(複数のto_entryをまとめて消し込む)・N:N(同一to_entryを分割消込する)の
 * ケースを含めて検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import { copySettlementTag } from './copySettlementTag'

const SETTLEMENT_ACCOUNT_ID = 10

function buildToEntry(
  id: number,
  amount: number,
  tag: { projectId: number | null; householdMemberId: number | null },
): JournalEntry {
  return {
    id,
    entryDate: '2026-01-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lines: [
      {
        id: id * 10 + 1,
        journalEntryId: id,
        accountId: 999,
        projectId: null,
        householdMemberId: null,
        counterpartyId: null,
        side: 'debit',
        amount,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: id * 10 + 2,
        journalEntryId: id,
        accountId: SETTLEMENT_ACCOUNT_ID,
        projectId: tag.projectId,
        householdMemberId: tag.householdMemberId,
        counterpartyId: null,
        side: 'credit',
        amount,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
}

describe('copySettlementTag', () => {
  it('to_entry側の一時勘定行のタグをそのままコピーする', () => {
    const toEntry = buildToEntry(1, 120000, { projectId: 5, householdMemberId: 2 })

    const tag = copySettlementTag(toEntry, SETTLEMENT_ACCOUNT_ID)

    expect(tag).toEqual({ projectId: 5, householdMemberId: 2 })
  })

  it('タグが付いていないto_entryの場合はnullのタグを返す', () => {
    const toEntry = buildToEntry(1, 80000, { projectId: null, householdMemberId: null })

    const tag = copySettlementTag(toEntry, SETTLEMENT_ACCOUNT_ID)

    expect(tag).toEqual({ projectId: null, householdMemberId: null })
  })

  it('1:N(スマホ分割とタブレット分割を1件の消込でまとめて処理する)場合、to_entryごとに独立したタグを返す', () => {
    const smartphoneEntry = buildToEntry(1, 120000, { projectId: 100, householdMemberId: null })
    const tabletEntry = buildToEntry(2, 60000, { projectId: 200, householdMemberId: null })

    const smartphoneTag = copySettlementTag(smartphoneEntry, SETTLEMENT_ACCOUNT_ID)
    const tabletTag = copySettlementTag(tabletEntry, SETTLEMENT_ACCOUNT_ID)

    expect(smartphoneTag).toEqual({ projectId: 100, householdMemberId: null })
    expect(tabletTag).toEqual({ projectId: 200, householdMemberId: null })
  })

  it('N:N(同一to_entryを複数回にわたって分割消込する)場合、毎回同じタグを返す', () => {
    const toEntry = buildToEntry(1, 120000, { projectId: 100, householdMemberId: null })

    const firstInstallmentTag = copySettlementTag(toEntry, SETTLEMENT_ACCOUNT_ID)
    const secondInstallmentTag = copySettlementTag(toEntry, SETTLEMENT_ACCOUNT_ID)

    expect(firstInstallmentTag).toEqual(secondInstallmentTag)
  })

  it('settlementAccountIdに対応する行がto_entryに存在しない場合はエラーを投げる', () => {
    const toEntry = buildToEntry(1, 80000, { projectId: null, householdMemberId: null })

    expect(() => copySettlementTag(toEntry, 12345)).toThrow()
  })
})
