/**
 * 割勘で発生した立替金の精算(せいさん)が、settlement-batchドメインの既存ロジック
 * (calculateSettlementBatchBalance・findUnsettledSettlementBatchBalances)をそのまま再利用する
 * だけで動作し、割勘専用の追加実装を必要としないことを確認する回帰テスト(docs/domain/
 * expense-splitting.md 1.5節「精算はこの按分そのものとは別の処理である」)。計画Issue #133により
 * 消込の仕組みがjournal_entry_linksから`settlement_batch_id`タグの集計方式に置き換わったため、
 * docs/domain/expense-splitting.md 1.3節の例(Aさんが立て替えた500円をBさんの口座CSVで精算する
 * 精算1)に沿った割勘仕訳を組み立て、settlement-batchドメインの関数へそのまま渡す。
 * DB非依存、外部依存なし。expense-splitting側に新しい精算ロジックのソースファイルは作らない。
 */
import { describe, expect, it } from 'vitest'
import type { JournalLine } from '../journal/JournalEntry'
import { calculateSettlementBatchBalance } from '../settlement-batch/calculateSettlementBatchBalance'
import { findUnsettledSettlementBatchBalances } from '../settlement-batch/findUnsettledSettlementBatchBalances'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from './buildHouseholdMemberExpenseSplittingJournalEntryInput'

const EXPENSE_ACCOUNT_ID = 1
const ADVANCE_ASSET_ACCOUNT_ID = 10 // 資産・立替金(Aさんの債権)
const ADVANCE_LIABILITY_ACCOUNT_ID = 11 // 負債・立替金(Bさんの債務)
const MEMBER_A = 100
const MEMBER_B = 200
const SETTLEMENT_BATCH_ID = 26
const SPLIT_ENTRY_ID = 1000

function toSplitLines(): JournalLine[] {
  const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
    expenseAccountId: EXPENSE_ACCOUNT_ID,
    advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
    advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
    fromMemberId: MEMBER_A,
    toMemberId: MEMBER_B,
    settlementBatchId: SETTLEMENT_BATCH_ID,
    amount: 500,
    entryDate: '2026-07-15',
  })

  // JournalEntryRepository.create()が採番・付与するid等をテスト用に補ってJournalLineとして
  // 組み立て直す(Repository実装のスコープ外、DB非依存)
  return input.lines.map((line, index) => ({
    id: SPLIT_ENTRY_ID * 10 + index,
    journalEntryId: SPLIT_ENTRY_ID,
    accountId: line.accountId,
    projectId: line.projectId ?? null,
    householdMemberId: line.householdMemberId ?? null,
    counterpartyId: line.counterpartyId ?? null,
    settlementBatchId: line.settlementBatchId ?? null,
    side: line.side,
    amount: line.amount,
    createdAt: '2026-07-15T00:00:00.000Z',
  }))
}

/** 割勘仕訳の負債側立替金行(Bさんの債務)を精算1相当で消し込む精算仕訳の行(settlementBatchIdタグ付き) */
function buildSettlementLine(amount: number): JournalLine {
  return {
    id: 20001,
    journalEntryId: 2000,
    accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
    projectId: null,
    householdMemberId: MEMBER_B,
    counterpartyId: null,
    settlementBatchId: SETTLEMENT_BATCH_ID,
    side: 'debit',
    amount,
    createdAt: '2026-07-31T00:00:00.000Z',
  }
}

describe('割勘由来の立替金の精算(settlement-batchドメインの集計方式の再利用)', () => {
  it('精算前は、割勘仕訳の負債側立替金(Bさんの債務)を未精算残高として計算できる(割勘専用実装なし)', () => {
    const splitLines = toSplitLines()

    const balance = calculateSettlementBatchBalance(splitLines, 'liability', {
      settlementBatchId: SETTLEMENT_BATCH_ID,
      accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      householdMemberId: MEMBER_B,
      counterpartyId: null,
    })

    expect(balance).toBe(500)
  })

  it('精算1(Bさんの口座CSV)相当の仕訳が作成されると、未精算残高が0になる(割勘専用実装なし)', () => {
    const allLines = [...toSplitLines(), buildSettlementLine(500)]

    const balance = calculateSettlementBatchBalance(allLines, 'liability', {
      settlementBatchId: SETTLEMENT_BATCH_ID,
      accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      householdMemberId: MEMBER_B,
      counterpartyId: null,
    })

    expect(balance).toBe(0)
  })

  it('findUnsettledSettlementBatchBalancesで、割勘仕訳の負債側立替金がまだ未精算であることを判定できる(割勘専用実装なし)', () => {
    const splitLines = toSplitLines()

    const result = findUnsettledSettlementBatchBalances(
      splitLines,
      SETTLEMENT_BATCH_ID,
      ADVANCE_LIABILITY_ACCOUNT_ID,
      'liability',
    )

    expect(result).toEqual([{ householdMemberId: MEMBER_B, counterpartyId: null, balance: 500 }])
  })

  it('精算1が完了すると、findUnsettledSettlementBatchBalancesの未精算一覧から除外される(割勘専用実装なし)', () => {
    const allLines = [...toSplitLines(), buildSettlementLine(500)]

    const result = findUnsettledSettlementBatchBalances(
      allLines,
      SETTLEMENT_BATCH_ID,
      ADVANCE_LIABILITY_ACCOUNT_ID,
      'liability',
    )

    expect(result).toEqual([])
  })
})
