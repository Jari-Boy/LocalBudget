/**
 * buildSettlementCloseEntries(精算バッチをクローズするときに、残りの残高を雑損失・雑収入へ振り替える仕訳の組み立て)のユニットテスト。
 * 方向(未収金・未払金)と世帯メンバーごとに残高が残っている分だけ仕訳を作ること、残高の向きごとの
 * 借方・貸方と損益の振り分け(未収の放棄は雑損失、未払の免除は雑収入)、残高が0のときは何も作らないことを検証する
 * (計画Issue #249、docs/domain/settlement.md)。DB非依存の純粋関数。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalLine } from '../journal/JournalEntry'
import type { SettlementBatch } from './SettlementBatch'
import { buildSettlementCloseEntries } from './buildSettlementCloseEntries'
import { summarizeSettlementBatch } from './summarizeSettlementBatch'

const BATCH_ID = 1
const ADVANCE_ID = 10
const PAYABLE_ID = 20
const GAIN_ID = 40
const LOSS_ID = 41

const batch: SettlementBatch = {
  id: BATCH_ID,
  name: '2026 年末旅行',
  type: 'expense_splitting',
  counterpartyId: null,
  isActive: true,
  createdAt: '',
  updatedAt: '',
}

const accounts = [
  { id: ADVANCE_ID, name: '未収金(精算バッチ)', category: 'asset', isReconcilable: false, isSystemManaged: true, householdMemberId: null },
  { id: PAYABLE_ID, name: '未払金(精算バッチ)', category: 'liability', isReconcilable: false, isSystemManaged: true, householdMemberId: null },
  { id: GAIN_ID, name: '雑収入', category: 'revenue', isReconcilable: null, isSystemManaged: false, householdMemberId: null },
  { id: LOSS_ID, name: '雑損失', category: 'expense', isReconcilable: null, isSystemManaged: false, householdMemberId: null },
] as Account[]

let nextId = 1
function line(overrides: Partial<JournalLine> & Pick<JournalLine, 'accountId' | 'side' | 'amount'>): JournalLine {
  return {
    id: nextId++,
    journalEntryId: 1,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: BATCH_ID,
    createdAt: '',
    ...overrides,
  }
}

function build(lines: JournalLine[]) {
  return buildSettlementCloseEntries({
    summary: summarizeSettlementBatch(batch, lines, accounts),
    accounts,
    gainAccountId: GAIN_ID,
    lossAccountId: LOSS_ID,
    entryDate: '2026-11-23',
    memo: '2026 年末旅行 クローズ(残高の振替)',
  })
}

describe('buildSettlementCloseEntries', () => {
  it('未収金の残高は、雑損失(借方)・未収金(貸方)の仕訳で0にする', () => {
    const [entry, ...rest] = build([line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 })])

    expect(rest).toEqual([])
    expect(entry.lines).toEqual([
      expect.objectContaining({ accountId: LOSS_ID, side: 'debit', amount: 6000 }),
      expect.objectContaining({ accountId: ADVANCE_ID, side: 'credit', amount: 6000, settlementBatchId: BATCH_ID, householdMemberId: 1 }),
    ])
  })

  it('未払金の残高は、未払金(借方)・雑収入(貸方)の仕訳で0にする', () => {
    const [entry] = build([line({ accountId: PAYABLE_ID, side: 'credit', amount: 2500 })])

    expect(entry.lines).toEqual([
      expect.objectContaining({ accountId: PAYABLE_ID, side: 'debit', amount: 2500, settlementBatchId: BATCH_ID }),
      expect.objectContaining({ accountId: GAIN_ID, side: 'credit', amount: 2500 }),
    ])
  })

  it('残高が負(未収金が貸方残、相手へ返す側)のときは、向きを逆にして雑収入に振り替える', () => {
    const [entry] = build([line({ accountId: ADVANCE_ID, side: 'credit', amount: 3000 })])

    expect(entry.lines).toEqual([
      expect.objectContaining({ accountId: ADVANCE_ID, side: 'debit', amount: 3000, settlementBatchId: BATCH_ID }),
      expect.objectContaining({ accountId: GAIN_ID, side: 'credit', amount: 3000 }),
    ])
  })

  it('未収金と未払金の両方に残高があるときは、方向ごとに1件ずつ仕訳を作る(相殺しない)', () => {
    const entries = build([
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 6000 }),
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 2500 }),
    ])

    expect(entries).toHaveLength(2)
  })

  it('世帯メンバーごとに残高が残っているときは、メンバーごとに仕訳を作り、起票者もそのメンバーにする', () => {
    const entries = build([
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 4000, householdMemberId: 1 }),
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 1000, householdMemberId: 2 }),
    ])

    expect(entries.map((e) => e.householdMemberId)).toEqual([1, 2])
    expect(entries.map((e) => e.lines[1].householdMemberId)).toEqual([1, 2])
  })

  it('残高がすでに0の方向・メンバーには仕訳を作らない', () => {
    const entries = build([
      line({ accountId: ADVANCE_ID, side: 'debit', amount: 4000, householdMemberId: 1 }),
      line({ accountId: ADVANCE_ID, side: 'credit', amount: 4000, householdMemberId: 1 }),
      line({ accountId: PAYABLE_ID, side: 'credit', amount: 700, householdMemberId: 2 }),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].lines[0]).toMatchObject({ accountId: PAYABLE_ID, amount: 700 })
  })

  it('残高がすべて0、または明細が無いときは、何も作らない', () => {
    expect(build([])).toEqual([])
    expect(
      build([
        line({ accountId: ADVANCE_ID, side: 'debit', amount: 100 }),
        line({ accountId: ADVANCE_ID, side: 'credit', amount: 100 }),
      ]),
    ).toEqual([])
  })

  it('取引日と摘要を、渡した値にする', () => {
    const [entry] = build([line({ accountId: ADVANCE_ID, side: 'debit', amount: 100 })])

    expect(entry).toMatchObject({ entryDate: '2026-11-23', memo: '2026 年末旅行 クローズ(残高の振替)' })
  })
})
