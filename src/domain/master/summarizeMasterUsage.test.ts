/**
 * summarizeMasterUsage / listDeletionBlocks(計画Issue #154)のテスト。
 * マスタ画面(科目・取引先・プロジェクト・世帯メンバー・定期取引)の「削除できるか」を判定する
 * 純粋関数を検証する。仕訳・予算・定期取引ルール・精算バッチ・科目の名義から、項目ごとの
 * 使用状況を集計し、Issueの削除条件の表(科目/取引先/プロジェクト/世帯メンバー/定期取引ルール)
 * どおりに「削除できない理由」を返すこと、初期残高の仕訳だけが紐づく口座は例外として
 * 仕訳と一緒に削除できることを確認する。DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalEntrySourceType, JournalLine } from '../journal/JournalEntry'
import { listDeletionBlocks, summarizeMasterUsage } from './summarizeMasterUsage'

let lineSeq = 0

function makeLine(overrides: Partial<JournalLine> & Pick<JournalLine, 'accountId'>): JournalLine {
  lineSeq += 1
  return {
    id: lineSeq,
    journalEntryId: 0,
    side: 'debit',
    amount: 1000,
    projectId: null,
    householdMemberId: null,
    counterpartyId: null,
    ...overrides,
  } as JournalLine
}

function makeEntry(
  id: number,
  lines: JournalLine[],
  overrides: Partial<JournalEntry> = {},
): JournalEntry {
  return {
    id,
    entryDate: '2026-11-01',
    memo: null,
    comment: null,
    currency: 'JPY',
    sourceType: 'manual' as JournalEntrySourceType,
    householdMemberId: 1,
    generatedFromRuleId: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lines,
    ...overrides,
  }
}

const emptyInput = { entries: [], budgets: [], rules: [], settlementBatches: [], accounts: [] }

describe('summarizeMasterUsage', () => {
  it('何も使われていない項目は、すべての使用件数が0になる', () => {
    const usage = summarizeMasterUsage(emptyInput)

    expect(usage.get('account', 10)).toEqual({
      journalLines: 0,
      initialBalanceEntryIds: [],
      budgets: 0,
      recurringRules: 0,
      settlementBatches: 0,
      entryAuthors: 0,
      accountOwners: 0,
      generatedEntries: 0,
    })
  })

  it('科目は、仕訳の明細・予算・定期取引ルールの借方と貸方で使われた件数を数える', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [makeEntry(1, [makeLine({ accountId: 10 }), makeLine({ accountId: 11, side: 'credit' })])],
      budgets: [{ accountId: 10 }],
      rules: [
        { debitAccountId: 10, creditAccountId: 12 },
        { debitAccountId: 13, creditAccountId: 10 },
      ] as never,
    })

    const account = usage.get('account', 10)
    expect(account.journalLines).toBe(1)
    expect(account.budgets).toBe(1)
    expect(account.recurringRules).toBe(2)
    expect(usage.get('account', 11).journalLines).toBe(1)
  })

  it('初期残高の仕訳の明細は通常の使用件数に数えず、その仕訳のidを別に持つ', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [
        makeEntry(1, [makeLine({ accountId: 10 }), makeLine({ accountId: 99, side: 'credit' })], {
          sourceType: 'initial_balance',
        }),
        makeEntry(2, [makeLine({ accountId: 10 })]),
      ],
    })

    const account = usage.get('account', 10)
    expect(account.journalLines).toBe(1)
    expect(account.initialBalanceEntryIds).toEqual([1])
  })

  it('取引先は、仕訳の明細・定期取引ルール・精算バッチの相手で使われた件数を数える', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [makeEntry(1, [makeLine({ accountId: 10, counterpartyId: 5 })])],
      rules: [{ counterpartyId: 5 }] as never,
      settlementBatches: [{ counterpartyId: 5 }, { counterpartyId: null }],
    })

    const counterparty = usage.get('counterparty', 5)
    expect(counterparty.journalLines).toBe(1)
    expect(counterparty.recurringRules).toBe(1)
    expect(counterparty.settlementBatches).toBe(1)
  })

  it('プロジェクトは、仕訳の明細と定期取引ルールで使われた件数を数える', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [makeEntry(1, [makeLine({ accountId: 10, projectId: 7 })])],
      rules: [{ projectId: 7 }] as never,
    })

    const project = usage.get('project', 7)
    expect(project.journalLines).toBe(1)
    expect(project.recurringRules).toBe(1)
  })

  it('世帯メンバーは、仕訳の明細・仕訳の起票者・科目の名義・定期取引ルールで使われた件数を数える', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [
        makeEntry(1, [makeLine({ accountId: 10, householdMemberId: 3 })], { householdMemberId: 3 }),
      ],
      accounts: [{ householdMemberId: 3 }, { householdMemberId: null }],
      rules: [{ householdMemberId: 3 }] as never,
    })

    const member = usage.get('householdMember', 3)
    expect(member.journalLines).toBe(1)
    expect(member.entryAuthors).toBe(1)
    expect(member.accountOwners).toBe(1)
    expect(member.recurringRules).toBe(1)
  })

  it('定期取引ルールは、そのルールから生成された仕訳の件数を数える', () => {
    const usage = summarizeMasterUsage({
      ...emptyInput,
      entries: [
        makeEntry(1, [makeLine({ accountId: 10 })], { generatedFromRuleId: 4 }),
        makeEntry(2, [makeLine({ accountId: 10 })], { generatedFromRuleId: 4 }),
      ],
    })

    expect(usage.get('recurringRule', 4).generatedEntries).toBe(2)
  })
})

describe('listDeletionBlocks', () => {
  const unused = summarizeMasterUsage(emptyInput).get('account', 1)

  it('使われていない項目は、削除できない理由が空になる', () => {
    expect(listDeletionBlocks('account', unused)).toEqual([])
  })

  it('科目は、仕訳・予算・定期取引ルールで使用中のとき、その理由を件数つきで返す', () => {
    const blocks = listDeletionBlocks('account', {
      ...unused,
      journalLines: 2,
      budgets: 1,
      recurringRules: 3,
      settlementBatches: 9,
    })

    expect(blocks).toEqual([
      { source: 'journalLines', count: 2 },
      { source: 'budgets', count: 1 },
      { source: 'recurringRules', count: 3 },
    ])
  })

  it('取引先は、仕訳・定期取引ルール・精算バッチの相手で使用中のとき、その理由を返す', () => {
    const blocks = listDeletionBlocks('counterparty', {
      ...unused,
      journalLines: 1,
      recurringRules: 1,
      settlementBatches: 1,
      budgets: 5,
    })

    expect(blocks.map((b) => b.source)).toEqual(['journalLines', 'recurringRules', 'settlementBatches'])
  })

  it('プロジェクトは、仕訳・定期取引ルールで使用中のときだけ理由を返す', () => {
    const blocks = listDeletionBlocks('project', {
      ...unused,
      journalLines: 1,
      recurringRules: 1,
      settlementBatches: 4,
    })

    expect(blocks.map((b) => b.source)).toEqual(['journalLines', 'recurringRules'])
  })

  it('世帯メンバーは、仕訳・仕訳の起票者・科目の名義・定期取引ルールで使用中の理由を返す', () => {
    const blocks = listDeletionBlocks('householdMember', {
      ...unused,
      journalLines: 1,
      entryAuthors: 1,
      accountOwners: 1,
      recurringRules: 1,
    })

    expect(blocks.map((b) => b.source)).toEqual([
      'journalLines',
      'entryAuthors',
      'accountOwners',
      'recurringRules',
    ])
  })

  it('定期取引ルールは、生成済みの仕訳があるときだけ理由を返す', () => {
    expect(listDeletionBlocks('recurringRule', { ...unused, generatedEntries: 0 })).toEqual([])
    expect(listDeletionBlocks('recurringRule', { ...unused, generatedEntries: 3 })).toEqual([
      { source: 'generatedEntries', count: 3 },
    ])
  })

  it('口座に初期残高の仕訳だけが紐づくときは、理由が空で、その仕訳と一緒に削除できる', () => {
    const usage = { ...unused, journalLines: 0, initialBalanceEntryIds: [8] }

    expect(listDeletionBlocks('account', usage)).toEqual([])
  })

  it('初期残高の仕訳のほかに通常の仕訳もある口座は、削除できない', () => {
    const usage = { ...unused, journalLines: 1, initialBalanceEntryIds: [8] }

    expect(listDeletionBlocks('account', usage)).toEqual([{ source: 'journalLines', count: 1 }])
  })
})
