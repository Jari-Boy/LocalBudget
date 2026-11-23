/**
 * submitExpenseSplit(割勘タブの「割勘を記録」で行う起票処理、計画Issue #153。計画Issue #271で選んだ明細行単位にした)の
 * ユニットテスト。分担相手ごとに割勘仕訳を1件ずつ作ること、選んだ行の元の行idを仕訳に持たせること、精算バッチを
 * 新規作成する/既存を使う場合の扱い、元の仕訳と同じ関連仕訳グループへの合流、借方・貸方の行を一緒に選んだときの
 * 純額の按分、金額指定の配分、入力が足りないときに何も書き込まずエラーを返すことを、偽のRepositoryで検証する。外部依存なし。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { CreateJournalEntryInput, JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { submitExpenseSplit, type SubmitExpenseSplitRepositories } from './submitExpenseSplit'

const FOOD = 1
const CASH = 2
const ADVANCE_ASSET = 3
const ADVANCE_LIABILITY = 4
const INCOME = 5

function account(id: number, category: Account['category'], isSystemManaged = false): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

const ACCOUNTS = [
  account(FOOD, 'expense'),
  account(INCOME, 'revenue'),
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

function entryOf(id: number, lines: JournalLine[]): JournalEntry {
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
    lines,
  }
}

/** 食費(借方)と現金(貸方)の2行の仕訳。行idは 食費=id*10、現金=id*10+1 */
function original(id: number, amount: number): JournalEntry {
  return entryOf(id, [line(FOOD, 'debit', amount, id * 10), line(CASH, 'credit', amount, id * 10 + 1)])
}

/** 借方の食費(amount)と、貸方の収益(refund。返金など)を持つ仕訳。行idは 食費=id*10、現金=id*10+1、収益=id*10+2 */
function withRefund(id: number, amount: number, refund: number): JournalEntry {
  return entryOf(id, [
    line(FOOD, 'debit', amount, id * 10),
    line(CASH, 'credit', amount - refund, id * 10 + 1),
    line(INCOME, 'credit', refund, id * 10 + 2),
  ])
}

/** 仕訳の n 番目(0始まり)の行を、割勘する行として選ぶ */
function pick(entry: JournalEntry, ...indexes: number[]) {
  return indexes.map((i) => ({ entry, line: entry.lines[i] }))
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

/** 世帯メンバー2の行(相手) */
const memberRow = (ratio: string, amount = '') => ({
  key: 1,
  kind: 'householdMember' as const,
  targetId: 2,
  ratioInput: ratio,
  amountInput: amount,
})

/** 世帯メンバー1(立替者本人)の行。負担する人には、立て替えた本人も入れる(計画Issue #271) */
const selfRow = (ratio: string, amount = '') => ({
  key: 99,
  kind: 'householdMember' as const,
  targetId: 1,
  ratioInput: ratio,
  amountInput: amount,
})

const SPLIT_50 = [memberRow('50'), selfRow('50')]

describe('submitExpenseSplit', () => {
  it('世帯メンバー1人(50%)の割勘を1件の仕訳にし、元の行idを持たせ、新しい精算バッチを作って元の仕訳と同じグループに合流する', async () => {
    const { repos, created } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 0),
      participants: SPLIT_50,
      repositories: repos,
    })

    expect(result).toEqual({ ok: true, createdEntries: [{ id: 500 }] })
    expect(repos.settlementBatchRepository.create).toHaveBeenCalledWith({
      name: 'ランチの割勘',
      type: 'expense_splitting',
      counterpartyId: null,
    })
    expect(created).toHaveLength(1)
    expect(created[0].expenseSplitSourceLineIds).toEqual([10])
    const settlementLines = created[0].lines.filter(
      (l) => l.accountId === ADVANCE_ASSET || l.accountId === ADVANCE_LIABILITY,
    )
    expect(settlementLines.every((l) => l.settlementBatchId === 77 && l.amount === 500)).toBe(true)
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1], [500])
  })

  it('選ばなかった行(同じ仕訳の別の費用の行)は割勘の対象にしない', async () => {
    const { repos, created } = fakeRepos()
    const e = entryOf(1, [line(FOOD, 'debit', 600, 10), line(FOOD, 'debit', 400, 12), line(CASH, 'credit', 1000, 11)])

    await submitExpenseSplit({ ...base, selectedLines: pick(e, 1), participants: SPLIT_50, repositories: repos })

    expect(created[0].expenseSplitSourceLineIds).toEqual([12])
    expect(created[0].lines.find((l) => l.accountId === ADVANCE_ASSET)?.amount).toBe(200)
  })

  it('分担相手が2人なら、相手ごとに1件ずつ仕訳を作る', async () => {
    const { repos, created } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 0),
      participants: [
        { key: 1, kind: 'householdMember', targetId: 2, ratioInput: '30', amountInput: '' },
        { key: 2, kind: 'counterparty', targetId: 9, ratioInput: '20', amountInput: '' },
        selfRow('50'),
      ],
      repositories: repos,
    })

    expect(created).toHaveLength(2)
  })

  it('世帯外の相手を含むと、新しい精算バッチにその取引先を設定する', async () => {
    const { repos } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 0),
      participants: [{ key: 1, kind: 'counterparty', targetId: 9, ratioInput: '50', amountInput: '' }, selfRow('50')],
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
      selectedLines: pick(original(1, 1000), 0),
      participants: [{ key: 1, kind: 'counterparty', targetId: 9, ratioInput: '50', amountInput: '' }, selfRow('50')],
      repositories: repos,
    })

    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repos.settlementBatchRepository.update).toHaveBeenCalledWith(5, { counterpartyId: 9 })
  })

  it('借方の行と貸方の行(返金・収益)を一緒に選ぶと、貸方は逆向きで、立替金は純額になる', async () => {
    const { repos, created } = fakeRepos()
    const e = withRefund(1, 1000, 400)

    await submitExpenseSplit({ ...base, selectedLines: pick(e, 0, 2), participants: SPLIT_50, repositories: repos })

    expect(created[0].expenseSplitSourceLineIds).toEqual([10, 12])
    // 借方1000の半分500と、貸方400の半分200(逆向き)の差し引きで立替金は300
    expect(created[0].lines.find((l) => l.accountId === ADVANCE_ASSET)).toMatchObject({ side: 'debit', amount: 300 })
    expect(created[0].lines.find((l) => l.accountId === ADVANCE_LIABILITY)).toMatchObject({ side: 'credit', amount: 300 })
  })

  it('貸方の行だけを選ぶと、立替金は貸方・未払金は借方になる(相手へ返す向き)', async () => {
    const { repos, created } = fakeRepos()
    const e = withRefund(1, 1000, 400)

    await submitExpenseSplit({ ...base, selectedLines: pick(e, 2), participants: SPLIT_50, repositories: repos })

    expect(created[0].lines.find((l) => l.accountId === ADVANCE_ASSET)).toMatchObject({ side: 'credit', amount: 200 })
    expect(created[0].lines.find((l) => l.accountId === ADVANCE_LIABILITY)).toMatchObject({ side: 'debit', amount: 200 })
  })

  it('金額指定の按分では、入力した金額を選んだ行へ純額に対する割合で配分する(複数の行でも使える)', async () => {
    const { repos, created } = fakeRepos()
    const e = withRefund(1, 1000, 400) // 純額 600

    await submitExpenseSplit({
      ...base,
      allocationMode: 'amount',
      selectedLines: pick(e, 0, 2),
      participants: [memberRow('', '300'), selfRow('', '300')],
      repositories: repos,
    })

    expect(created[0].lines.find((l) => l.accountId === ADVANCE_ASSET)).toMatchObject({ side: 'debit', amount: 300 })
  })

  it('金額指定で純額が0の行の組み合わせは、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()
    const e = withRefund(1, 400, 400)

    const result = await submitExpenseSplit({
      ...base,
      allocationMode: 'amount',
      selectedLines: pick(e, 0, 2),
      participants: [memberRow('', '100')],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'amountNetZero' })
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('割合の合計が100%でなければ、何も書き込まずエラーを返す(立て替えた本人の分も入れて100%にする)', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 0),
      participants: [memberRow('50'), selfRow('40')],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'ratioTotalMismatch' })
    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('金額指定の合計が選んだ行の純額と合わないなら、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      allocationMode: 'amount',
      selectedLines: pick(original(1, 1000), 0),
      participants: [memberRow('', '1200')],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'amountTotalMismatch' })
    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
  })

  it('費用・収益でない行(支払元の資産の行など)が混ざると、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 1),
      participants: SPLIT_50,
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'expenseAccountNotFound' })
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('摘要が空(空白だけを含む)なら、何も書き込まずエラーを返す。摘要は必須', async () => {
    const { repos } = fakeRepos()

    for (const memo of ['', '   ']) {
      const result = await submitExpenseSplit({
        ...base,
        memo,
        selectedLines: pick(original(1, 1000), 0),
        participants: SPLIT_50,
        repositories: repos,
      })
      expect(result).toEqual({ ok: false, error: 'memoRequired' })
    }
    expect(repos.settlementBatchRepository.create).not.toHaveBeenCalled()
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('相手を選んでいない世帯外の行があると、何も書き込まずエラーを返す', async () => {
    const { repos } = fakeRepos()

    const result = await submitExpenseSplit({
      ...base,
      selectedLines: pick(original(1, 1000), 0),
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
      selectedLines: pick(original(1, 1000), 0),
      participants: [memberRow('0'), selfRow('100')],
      repositories: repos,
    })

    expect(result).toEqual({ ok: false, error: 'noRecipient' })
    expect(repos.journalEntryRepository.create).not.toHaveBeenCalled()
  })

  it('複数の仕訳の行をまとめて割勘すると、分担相手ごとに1件の仕訳にまとめ、すべての元の仕訳と同じグループに合流する', async () => {
    const { repos, created } = fakeRepos()

    await submitExpenseSplit({
      ...base,
      selectedLines: [...pick(original(1, 1000), 0), ...pick(original(2, 600), 0)],
      participants: SPLIT_50,
      repositories: repos,
    })

    expect(created).toHaveLength(1)
    expect(created[0].expenseSplitSourceLineIds).toEqual([10, 20])
    expect(repos.journalEntryLinkGroupRepository.joinOrCreateGroups).toHaveBeenCalledWith([1, 2], [500])
  })
})
