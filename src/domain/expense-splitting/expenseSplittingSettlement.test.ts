/**
 * 割勘で発生した立替金の精算(せいさん)が、A7(消込、docs/domain/settlement.md)の
 * 既存ロジック(calculateSettlementBalance・findUnsettledEntries)をそのまま再利用するだけで
 * 動作し、割勘専用の追加実装を必要としないことを確認する回帰テスト(docs/domain/
 * expense-splitting.md 1.5節「精算はこの按分そのものとは別の処理であり、消込と同じsettlesを
 * 使う」)。docs/domain/expense-splitting.md 1.3節の例(Aさんが立て替えた500円をBさんの口座
 * CSVで精算する精算1)に沿った割勘仕訳を組み立て、settlementドメインの関数へそのまま渡す。
 * DB非依存、外部依存なし。expense-splitting側に新しい精算ロジックのソースファイルは作らない。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryLink } from '../journal/JournalEntryLink'
import { calculateSettlementBalance } from '../settlement/calculateSettlementBalance'
import { findUnsettledEntries } from '../settlement/findUnsettledEntries'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from './buildHouseholdMemberExpenseSplittingJournalEntryInput'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 10 // 資産・立替金(Aさんの債権)
const ADVANCE_LIABILITY_ACCOUNT_ID = 11 // 負債・立替金(Bさんの債務)
const MEMBER_A = 100
const MEMBER_B = 200
const PROJECT_ID = 26
const ORIGINAL_ENTRY_ID = 999
const SPLIT_ENTRY_ID = 1000

function toSplitEntry(): JournalEntry {
  const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
    originalEntryId: ORIGINAL_ENTRY_ID,
    expenseAccountId: EXPENSE_ACCOUNT_ID,
    advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
    advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
    fromMemberId: MEMBER_A,
    toMemberId: MEMBER_B,
    projectId: PROJECT_ID,
    amount: 500,
    entryDate: '2026-07-15',
  })

  // JournalEntryRepository.create()が採番・付与するid等をテスト用に補って
  // JournalEntryとして組み立て直す(Repository実装のスコープ外、DB非依存)
  return {
    id: SPLIT_ENTRY_ID,
    entryDate: input.entryDate,
    memo: input.memo ?? null,
    currency: 'JPY',
    sourceType: 'manual',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    lines: input.lines.map((line, index) => ({
      id: SPLIT_ENTRY_ID * 10 + index,
      journalEntryId: SPLIT_ENTRY_ID,
      accountId: line.accountId,
      projectId: line.projectId ?? null,
      householdMemberId: line.householdMemberId ?? null,
      counterpartyId: line.counterpartyId ?? null,
      side: line.side,
      amount: line.amount,
      createdAt: '2026-07-15T00:00:00.000Z',
    })),
  }
}

function buildSettlesLink(toEntryId: number, amount: number): JournalEntryLink {
  return {
    id: 1,
    fromEntryId: 2000,
    toEntryId,
    linkType: 'settles',
    amount,
    createdAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('割勘由来の立替金の精算(A7の消込ロジックの再利用)', () => {
  it('精算前は、割勘仕訳の負債側立替金(Bさんの債務)を消込残高として計算できる(割勘専用実装なし)', () => {
    const splitEntry = toSplitEntry()

    const balance = calculateSettlementBalance(splitEntry, ADVANCE_LIABILITY_ACCOUNT_ID, [])

    expect(balance).toBe(500)
  })

  it('精算1(Bさんの口座CSV)相当のsettlesリンクが作成されると、消込残高が0になる(割勘専用実装なし)', () => {
    const splitEntry = toSplitEntry()
    const settlesLink = buildSettlesLink(splitEntry.id, 500)

    const balance = calculateSettlementBalance(splitEntry, ADVANCE_LIABILITY_ACCOUNT_ID, [
      settlesLink,
    ])

    expect(balance).toBe(0)
  })

  it('findUnsettledEntriesで、割勘仕訳の負債側立替金がまだ未消込であることを判定できる(割勘専用実装なし)', () => {
    const splitEntry = toSplitEntry()

    const result = findUnsettledEntries([splitEntry], ADVANCE_LIABILITY_ACCOUNT_ID, new Map())

    expect(result).toEqual([splitEntry])
  })

  it('精算1が完了すると、findUnsettledEntriesの未消込一覧から除外される(割勘専用実装なし)', () => {
    const splitEntry = toSplitEntry()
    const settlesLink = buildSettlesLink(splitEntry.id, 500)
    const linksByEntryId = new Map([[splitEntry.id, [settlesLink]]])

    const result = findUnsettledEntries([splitEntry], ADVANCE_LIABILITY_ACCOUNT_ID, linksByEntryId)

    expect(result).toEqual([])
  })
})
