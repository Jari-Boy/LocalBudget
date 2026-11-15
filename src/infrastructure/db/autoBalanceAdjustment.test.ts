/**
 * 残高の基準点に合わせた自動調整仕訳(計画Issue #205)の統合テスト。
 * sql.js(SQLite WASM)をNode上で動かし、仕訳の作成・更新・削除、取込の確定、手で記録した残高の
 * 追加・編集・削除、自動調整のオン・オフのたびに、同じトランザクションで自動調整仕訳が計算し直される
 * ことを検証する(docs/domain/reconciliation.md 1.5・1.6)。外部依存: sql.js のみ。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { seedBalanceAdjustmentAccount } from './seedBalanceAdjustmentAccount'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { SqlJsAccountBalanceRecordRepository } from './SqlJsAccountBalanceRecordRepository'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { AutoBalanceAdjustmentEntryReadOnlyError } from '../../domain/journal/AutoBalanceAdjustmentEntryReadOnlyError'

let db: Database
let accounts: SqlJsAccountRepository
let journal: SqlJsJournalEntryRepository
let records: SqlJsAccountBalanceRecordRepository
let memberId: number
let cashId: number
let cardId: number
let bankId: number
let foodId: number
let salaryId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  accounts = new SqlJsAccountRepository(db)
  journal = new SqlJsJournalEntryRepository(db)
  records = new SqlJsAccountBalanceRecordRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  seedInitialBalanceAccount(db)
  seedBalanceAdjustmentAccount(db)
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  bankId = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true }).id
  cardId = accounts.create({ category: 'liability', name: 'カード', isReconcilable: false }).id
  foodId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  salaryId = accounts.create({ category: 'revenue', name: '給与', isReconcilable: null }).id
})

function spend(accountId: number, date: string, amount: number) {
  return journal.create({
    entryDate: date,
    memo: '支出',
    householdMemberId: memberId,
    lines: [
      { accountId: foodId, side: 'debit', amount, householdMemberId: memberId },
      { accountId, side: 'credit', amount, householdMemberId: memberId },
    ],
  })
}

function income(accountId: number, date: string, amount: number) {
  return journal.create({
    entryDate: date,
    memo: '収入',
    householdMemberId: memberId,
    lines: [
      { accountId, side: 'debit', amount, householdMemberId: memberId },
      { accountId: salaryId, side: 'credit', amount, householdMemberId: memberId },
    ],
  })
}

function autoEntries(accountId: number) {
  return journal
    .findAll()
    .filter((e) => e.sourceType === 'auto_balance_adjustment' && e.lines.some((l) => l.accountId === accountId))
}

/** 科目の借方 - 貸方の残高(資産の向き)。負債は貸方 - 借方なので呼び出し側で符号を反転する */
function debitMinusCredit(accountId: number, upTo: string): number {
  return journal
    .findAll()
    .filter((e) => e.entryDate <= upTo)
    .flatMap((e) => e.lines)
    .filter((l) => l.accountId === accountId)
    .reduce((sum, l) => sum + (l.side === 'debit' ? l.amount : -l.amount), 0)
}

describe('手で記録した残高の追加・編集・削除', () => {
  it('最初の記録の差額は純資産「初期残高」を相手科目とする元手の仕訳になる', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-10', balance: 10000 })

    const [entry] = autoEntries(cashId)
    expect(entry.entryDate).toBe('2026-01-10')
    expect(entry.memo).toBe('初期残高(現金)')
    const initialId = accounts.findAll().find((a) => a.category === 'equity')!.id
    expect(entry.lines.map((l) => [l.accountId, l.side, l.amount]).sort()).toEqual(
      [
        [cashId, 'debit', 10000],
        [initialId, 'credit', 10000],
      ].sort(),
    )
    expect(debitMinusCredit(cashId, '2026-01-10')).toBe(10000)
  })

  it('2つ目の記録との食い違いは、区間の終わりの日付に費用「残高調整」で入り、摘要に科目名と期間が入る', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-31', balance: 10000 })
    spend(cashId, '2026-02-10', 2000)
    records.create({ accountId: cashId, recordDate: '2026-02-28', balance: 7000 })

    const adjustment = autoEntries(cashId).find((e) => e.entryDate === '2026-02-28')!
    expect(adjustment.memo).toBe('残高の自動調整(現金 02/01〜02/28)')
    // 帳簿は 10000-2000=8000、記録は 7000 → 1000 減らす
    expect(adjustment.lines.find((l) => l.accountId === cashId)).toMatchObject({ side: 'credit', amount: 1000 })
    expect(debitMinusCredit(cashId, '2026-02-28')).toBe(7000)
  })

  it('食い違いの原因となる仕訳を足すと自動調整が消え、削除すると戻る', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-31', balance: 10000 })
    records.create({ accountId: cashId, recordDate: '2026-02-28', balance: 7000 })
    expect(autoEntries(cashId).filter((e) => e.entryDate === '2026-02-28')).toHaveLength(1)

    const missing = spend(cashId, '2026-02-10', 3000)
    expect(autoEntries(cashId).filter((e) => e.entryDate === '2026-02-28')).toHaveLength(0)

    journal.delete(missing.id)
    expect(autoEntries(cashId).filter((e) => e.entryDate === '2026-02-28')).toHaveLength(1)
  })

  it('記録の金額を編集すると調整額が変わり、削除すると元手ごと消える', () => {
    const record = records.create({ accountId: cashId, recordDate: '2026-01-10', balance: 10000 })
    records.update(record.id, { recordDate: '2026-01-10', balance: 12000 })
    expect(autoEntries(cashId)[0].lines.find((l) => l.accountId === cashId)!.amount).toBe(12000)

    records.delete(record.id)
    expect(autoEntries(cashId)).toHaveLength(0)
  })

  it('元手の日付は、記録より前の仕訳があればその一番古い仕訳の日になる', () => {
    income(cashId, '2026-01-05', 2000)
    records.create({ accountId: cashId, recordDate: '2026-01-10', balance: 10000 })
    expect(autoEntries(cashId)[0].entryDate).toBe('2026-01-05')
    expect(debitMinusCredit(cashId, '2026-01-10')).toBe(10000)
  })
})

describe('自動調整のオン・オフ', () => {
  it('オフにすると2つ目以降の調整は消えるが元手は残り、オンに戻すと再び入る', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-31', balance: 10000 })
    records.create({ accountId: cashId, recordDate: '2026-02-28', balance: 7000 })

    accounts.update(cashId, { autoBalanceAdjustment: false })
    expect(autoEntries(cashId).map((e) => e.entryDate)).toEqual(['2026-01-31'])

    accounts.update(cashId, { autoBalanceAdjustment: true })
    expect(autoEntries(cashId).map((e) => e.entryDate).sort()).toEqual(['2026-01-31', '2026-02-28'])
  })
})

describe('負債科目', () => {
  it('向きを反転して、基準点の日に残高(貸方 - 借方)が一致する', () => {
    records.create({ accountId: cardId, recordDate: '2026-01-31', balance: 5000 })
    spend(cardId, '2026-02-10', 1000)
    records.create({ accountId: cardId, recordDate: '2026-02-28', balance: 7000 })

    expect(-debitMinusCredit(cardId, '2026-01-31')).toBe(5000)
    expect(-debitMinusCredit(cardId, '2026-02-28')).toBe(7000)
  })
})

describe('取り込んだ明細の取引後残高', () => {
  it('取込確定で基準点が増え、取り込み開始直前の残高と各行の残高に帳簿が一致する', () => {
    const imported = (date: string, amount: number, balance: number, order: number) =>
      journal.create({
        entryDate: date,
        memo: 'CSV',
        sourceType: 'external_import',
        householdMemberId: memberId,
        lines:
          amount >= 0
            ? [
                { accountId: bankId, side: 'debit', amount, householdMemberId: memberId },
                { accountId: salaryId, side: 'credit', amount, householdMemberId: memberId },
              ]
            : [
                { accountId: foodId, side: 'debit', amount: -amount, householdMemberId: memberId },
                { accountId: bankId, side: 'credit', amount: -amount, householdMemberId: memberId },
              ],
        externalTransactionRef: {
          accountId: bankId,
          externalId: `ID-${order}`,
          entryDate: date,
          description: 'CSV',
          amount,
          externalBalanceAfter: balance,
          rowOrder: order,
          importedAt: '2026-03-01 00:00:00',
        },
      })
    // 降順のCSV(新しい行が先)。取り込み開始直前の残高は 10000
    imported('2026-02-11', -500, 10500, 0)
    imported('2026-02-10', 1000, 11000, 1)

    expect(debitMinusCredit(bankId, '2026-02-09')).toBe(10000)
    expect(debitMinusCredit(bankId, '2026-02-10')).toBe(11000)
    expect(debitMinusCredit(bankId, '2026-02-11')).toBe(10500)
  })
})

describe('自動調整仕訳の保護', () => {
  it('更新・削除はできない', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-10', balance: 10000 })
    const entry = autoEntries(cashId)[0]
    expect(() => journal.delete(entry.id)).toThrow(AutoBalanceAdjustmentEntryReadOnlyError)
    expect(() =>
      journal.update(entry.id, {
        entryDate: entry.entryDate,
        lines: entry.lines.map((l) => ({ ...l })),
      }),
    ).toThrow(AutoBalanceAdjustmentEntryReadOnlyError)
  })
})

describe('科目の削除', () => {
  it('自動で作られた仕訳と残高の記録だけなら、一緒に削除できる', () => {
    records.create({ accountId: cashId, recordDate: '2026-01-10', balance: 10000 })
    accounts.delete(cashId)
    expect(accounts.findById(cashId)).toBeNull()
    expect(journal.findAll()).toHaveLength(0)
  })

  it('手入力の仕訳があれば削除できない', () => {
    income(cashId, '2026-01-05', 100)
    expect(() => accounts.delete(cashId)).toThrow()
  })
})
