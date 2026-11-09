/**
 * submitSettlement(精算タブの「精算完了」「未精算として残す」「精算の仕訳を起票」の書き込み処理、
 * 計画Issue #153)のユニットテスト。旧精算画面(SettlementScreen)のhandleAssignSelected・
 * handleManualCreateを切り出したもの。選んだ仕訳の対象行へバッチのタグを付けること、
 * 差額を雑収入・雑損失に計上して残高を0にすること、仕訳を新規起票してバッチに紐づけること、
 * いずれも既存のタグ付き仕訳と同じ関連仕訳グループへ合流することを、偽のRepositoryで検証する。
 * 精算の行・相手科目の行には世帯メンバーが必ず入る(計画Issue #169)。外部依存なし。
 */
import { describe, expect, it, vi } from 'vitest'
import type { CreateJournalEntryInput, JournalEntry, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import { createLineHouseholdMemberResolver } from '../../domain/journal/resolveLineHouseholdMemberId'
import { createSettlementEntry, tagCandidatesToBatch, type SettlementRepositories } from './submitSettlement'

const ADVANCE = 10
const PAYABLE = 20
const GAIN = 91
const LOSS = 92
const BANK = 50

function fakeRepos() {
  const updated: { id: number; input: UpdateJournalEntryInput }[] = []
  const created: CreateJournalEntryInput[] = []
  const repos = {
    journalEntryRepository: {
      update: vi.fn(async (id: number, input: UpdateJournalEntryInput) => {
        updated.push({ id, input })
        return { id } as JournalEntry
      }),
      create: vi.fn(async (input: CreateJournalEntryInput) => {
        created.push(input)
        return { id: 900 + created.length } as JournalEntry
      }),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
  } satisfies SettlementRepositories
  return { repos, updated, created }
}

function candidate(entryId: number, lineId: number, amount: number) {
  const entry = {
    id: entryId,
    entryDate: '2026-10-05',
    memo: '妻から振込',
    lines: [
      { id: lineId, accountId: BANK, side: 'debit', amount, settlementBatchId: null },
      { id: lineId + 1, accountId: ADVANCE, side: 'credit', amount, settlementBatchId: null },
    ],
  } as unknown as JournalEntry
  return { entry, lineId: lineId + 1, amount }
}

const base = {
  batchId: 1,
  taggedEntryIds: [100],
  today: '2026-10-31',
  entryHouseholdMemberId: 1,
  resolveLineHouseholdMemberId: createLineHouseholdMemberResolver([], 1),
  adjustmentAccountIds: { gain: GAIN, loss: LOSS },
}

describe('tagCandidatesToBatch', () => {
  it('選んだ仕訳の対象行にバッチのタグを付け、既存のタグ付き仕訳と同じグループへ合流する', async () => {
    const { repos, updated } = fakeRepos()

    await tagCandidatesToBatch({
      ...base,
      direction: 'advance',
      accountId: ADVANCE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      candidates: [candidate(1, 11, 6000)],
      diff: 0,
      createAdjustment: false,
      repositories: repos,
    })

    const tagged = updated[0].input.lines?.find((l) => l.id === 12)
    expect(tagged?.settlementBatchId).toBe(1)
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([100], [1])
  })

  it('差額があって調整を選ぶと、立替金は多く受け取った分を雑収入に計上する調整仕訳を作る', async () => {
    const { repos, created } = fakeRepos()

    await tagCandidatesToBatch({
      ...base,
      direction: 'advance',
      accountId: ADVANCE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      candidates: [candidate(1, 11, 6150)],
      diff: 150,
      createAdjustment: true,
      repositories: repos,
    })

    expect(created).toHaveLength(1)
    expect(created[0].lines.some((l) => l.accountId === GAIN && l.amount === 150)).toBe(true)
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([100], [1, 901])
  })

  it('未払金は多く払った分(過払い)を雑損失に計上する', async () => {
    const { repos, created } = fakeRepos()

    await tagCandidatesToBatch({
      ...base,
      direction: 'payable',
      accountId: PAYABLE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      candidates: [candidate(1, 11, 6150)],
      diff: 150,
      createAdjustment: true,
      repositories: repos,
    })

    expect(created[0].lines.some((l) => l.accountId === LOSS && l.amount === 150)).toBe(true)
  })

  it('調整を選ばなければ、差額があっても調整仕訳は作らない(未精算として残す)', async () => {
    const { repos, created } = fakeRepos()

    await tagCandidatesToBatch({
      ...base,
      direction: 'advance',
      accountId: ADVANCE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      candidates: [candidate(1, 11, 5000)],
      diff: -1000,
      createAdjustment: false,
      repositories: repos,
    })

    expect(created).toEqual([])
  })
})

describe('createSettlementEntry', () => {
  it('立替金を減らす精算の仕訳は、相手科目を借方、立替金を貸方にしてバッチのタグを付ける', async () => {
    const { repos, created } = fakeRepos()

    await createSettlementEntry({
      ...base,
      direction: 'advance',
      accountId: ADVANCE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      counterAccountId: BANK,
      amount: 6000,
      entryDate: '2026-10-20',
      memo: '10月分 割勘 精算',
      repositories: repos,
    })

    const input = created[0]
    expect(input.entryDate).toBe('2026-10-20')
    expect(input.lines).toContainEqual(
      expect.objectContaining({ accountId: ADVANCE, side: 'credit', amount: 6000, settlementBatchId: 1, householdMemberId: 2 }),
    )
    expect(input.lines).toContainEqual(expect.objectContaining({ accountId: BANK, side: 'debit', amount: 6000 }))
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([100], [901])
  })

  it('未払金を減らす精算の仕訳は、未払金を借方(対象者の世帯メンバーの行)、相手科目を貸方(起票者の世帯メンバーの行)にする(計画Issue #169)', async () => {
    const { repos, created } = fakeRepos()

    await createSettlementEntry({
      ...base,
      direction: 'payable',
      accountId: PAYABLE,
      target: { kind: 'householdMember', householdMemberId: 2 },
      counterAccountId: BANK,
      amount: 2500,
      entryDate: '2026-10-20',
      memo: null,
      repositories: repos,
    })

    expect(created[0].lines).toContainEqual(expect.objectContaining({ accountId: PAYABLE, side: 'debit', householdMemberId: 2 }))
    expect(created[0].lines).toContainEqual(expect.objectContaining({ accountId: BANK, side: 'credit', householdMemberId: 1 }))
  })
})
