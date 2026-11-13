/**
 * submitExpenseSplit(割勘タブの「割勘を記録」で行う起票処理、計画Issue #153)のユニットテスト。
 * 旧割勘フォーム(ExpenseSplittingForm)のhandleSubmitを画面から切り出したもの。分担相手ごとに
 * 割勘仕訳を1件ずつ作ること、精算バッチを新規作成する/既存を使う場合の扱い、元の仕訳と同じ
 * 関連仕訳グループへの合流、入力が足りないときに何も書き込まずエラーを返すことを、
 * 偽のRepositoryで検証する。外部依存なし。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { submitExpenseSplit, type SubmitExpenseSplitRepositories } from './submitExpenseSplit'

const FOOD = 1
const CASH = 2
const ADVANCE_ASSET = 3
const ADVANCE_LIABILITY = 4

function account(id: number, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const ACCOUNTS = [
  account(FOOD, 'expense'),
  account(CASH, 'asset'),
  account(ADVANCE_ASSET, 'asset', true),
  account(ADVANCE_LIABILITY, 'liability', true),
]

function line(accountId: number, side: 'debit' | 'credit', amount: number, id: number): JournalLine {
  return {
    id,
    journalEntryId: 100,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function original(id: number, amount: number): JournalEntry {
  return {
    id,
    entryDate: '2026-10-01',
    memo: 'ランチ',
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    generatedFromRuleId: null,
    recurringDueDate: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    lines: [line(FOOD, 'debit', amount, id * 10), line(CASH, 'credit', amount, id * 10 + 1)],
  }
}

function fakeRepos() {
  let nextEntryId = 500
  const created: CreateJournalEntryInput[] = []
  const repos = {
    settlementBatchRepository: {
      create: vi.fn(async (input: { name: string; counterpartyId?: number | null }) => ({
        id: 77,
        name: input.name,
        type: 'expense_splitting' as const,
        counterpartyId: input.counterpartyId ?? null,
        createdAt: '',
        updatedAt: '',
      })),
      update: vi.fn(async () => ({}) as never),
    },
    journalEntryRepository: {
      create: vi.fn(async (input: CreateJournalEntryInput) => {
        created.push(input)
        return { id: nextEntryId++ } as JournalEntry
      }),
    },
    journalEntryLinkGroupRepository: { joinOrCreateGroups: vi.fn(async () => {}) },
  } satisfies SubmitExpenseSplitRepositories
  return { repos, created }
}

const base = {
  accounts: ACCOUNTS,
  allocationMode: 'ratio' as const,
  memo: 'ランチの割勘',
  settlementBatchId: 'new' as const,
  today: '2026-10-31',
  settlementBatches: [],
}

describe('submitExpenseSplit', () => {
  it('世帯メンバー1人(50%)の割勘を1件の仕訳にし、新しい精算バッチを摘要の名前で作って元の仕訳と同じグループに合流する', async () => {
    const { repos, created } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'householdMember', targetId: 2, ratioInput: '50', amountInput: '' }],
      repositories: repos,
    })

    expect(result).toEqual({ ok: true, createdEntries: [{ id: 500 }] })
    expect(repos.settlementBatchRepository.create).toHaveBeenCalledWith({
      name: 'ランチの割勘',
      type: 'expense_splitting',
      counterpartyId: null,
    })
    expect(created).toHaveLength(1)
    const settlementLines = created[0].lines.filter(
      (l) => l.accountId === ADVANCE_ASSET || l.accountId === ADVANCE_LIABILITY,
    )
    expect(settlementLines.every((l) => l.settlementBatchId === 77 && l.amount === 500)).toBe(true)
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1], [500])
  })

  it('分担相手が2人なら、相手ごとに1件ずつ仕訳を作る', async () => {
    const { repos, created } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000)],
      participants: [
        { key: 1, kind: 'householdMember', targetId: 2, ratioInput: '30', amountInput: '' },
        { key: 2, kind: 'counterparty', targetId: 9, ratioInput: '20', amountInput: '' },
      ],
      repositories: repos,
    })

    expect(created).toHaveLength(2)
  })

  it('世帯外の相手を含むと、新しい精算バッチにその取引先を設定する', async () => {
    const { repos } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'counterparty', targetId: 9, ratioInput: '50', amountInput: '' }],
      repositories: repos,
    })

    expect(repos.settlementBatchRepository.create).toHaveBeenCalledWith(expect.objectContaining({ counterpartyId: 9 }))
  })

  it('既存の精算バッチを選ぶと新規作成せず、取引先が未設定のバッチには世帯外の相手を設定する', async () => {
    const { repos } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      settlementBatchId: 5,
      settlementBatches: [
        { id: 5, name: '既存', type: 'expense_splitting', counterpartyId: null, createdAt: '', updatedAt: '' },
      ],
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'counterparty', targetId: 9, ratioInput: '50', amountInput: '' }],
      repositories: repos,
    })

    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repos.settlementBatchRepository.update).toHaveBeenCalledWith(5, { counterpartyId: 9 })
  })

  it('金額指定の按分では、入力した金額で仕訳を作る', async () => {
    const { repos, created } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      allocationMode: 'amount',
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'householdMember', targetId: 2, ratioInput: '', amountInput: '300' }],
      repositories: repos,
    })

    const advance = created[0].lines.find((l) => l.accountId === ADVANCE_ASSET)
    expect(advance?.amount).toBe(300)
  })

  it('相手を選んでいない世帯外の行があると、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'counterparty', targetId: null, ratioInput: '50', amountInput: '' }],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'counterpartyTargetRequired' })
    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('負担額がすべて0なら、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000)],
      participants: [{ key: 1, kind: 'householdMember', targetId: 2, ratioInput: '0', amountInput: '' }],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'noRecipient' })
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('複数の元仕訳をまとめて割勘すると、分担相手ごとに1件の仕訳にまとめる', async () => {
    const { repos, created } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      originalEntries: [original(1, 1000), original(2, 600)],
      participants: [{ key: 1, kind: 'householdMember', targetId: 2, ratioInput: '50', amountInput: '' }],
      repositories: repos,
    })

    expect(created).toHaveLength(1)
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1, 2], [500])
  })
})
