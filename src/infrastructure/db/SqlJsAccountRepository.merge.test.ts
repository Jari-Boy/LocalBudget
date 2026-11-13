/**
 * SqlJsAccountRepository の統合(merge)機能の統合テスト(計画Issue #97)。
 * docs/domain/accounts.md 2.2に定義された、複数の勘定科目(統合元)を1科目(統合先)へ集約する
 * 操作(journal_lines.account_idの一括付け替え、account_merge_logへの記録、統合できない
 * 組み合わせの拒否と全体のロールバック)が期待通り機能することを検証する。
 * 基本CRUDは SqlJsAccountRepository.test.ts で扱う。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { seedInitialBalanceAccount } from './seedInitialBalanceAccount'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'

let db: Database
let repository: SqlJsAccountRepository
let entries: SqlJsJournalEntryRepository
let memberId: number
let cashId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsAccountRepository(db)
  entries = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '夫' }).id
  cashId = repository.create({ category: 'asset', name: '現金', isReconcilable: false }).id
})

/** 費用科目(借方)と現金(貸方)の仕訳を1件登録し、仕訳IDを返す */
function spend(expenseId: number) {
  return entries.create({
    entryDate: '2026-11-01',
    householdMemberId: memberId,
    lines: [
      { householdMemberId: memberId, accountId: expenseId, side: 'debit', amount: 500 },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 500 },
    ],
  }).id
}

function lineAccountIds(entryId: number): number[] {
  const [result] = db.exec('SELECT account_id FROM journal_lines WHERE journal_entry_id = ? ORDER BY id', [entryId])
  return result.values.map((v) => v[0] as number)
}

function count(table: string): number {
  return db.exec(`SELECT COUNT(*) FROM ${table}`)[0].values[0][0] as number
}

function mergeLogs() {
  const [result] = db.exec(
    `SELECT target_account_id, target_account_name, source_account_id, source_account_name, line_count, merged_at
     FROM account_merge_log ORDER BY id`,
  )
  return (result?.values ?? []).map((v) => ({
    targetId: v[0], targetName: v[1], sourceId: v[2], sourceName: v[3], lineCount: v[4], mergedAt: v[5],
  }))
}

describe('merge', () => {
  it('統合元に紐づくjournal_lines.account_idを統合先へ付け替え、仕訳の件数は増やさない', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const entryId = spend(bus.id)
    const entriesBefore = count('journal_entries')
    const linesBefore = count('journal_lines')

    repository.merge(target.id, [bus.id])

    expect(lineAccountIds(entryId)).toEqual([target.id, cashId])
    expect(count('journal_entries')).toBe(entriesBefore)
    expect(count('journal_lines')).toBe(linesBefore)
  })

  it('複数の統合元を一度に統合先へ付け替える', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const train = repository.create({ category: 'expense', name: '電車賃', isReconcilable: null })
    const busEntry = spend(bus.id)
    const trainEntry = spend(train.id)

    repository.merge(target.id, [bus.id, train.id])

    expect(lineAccountIds(busEntry)[0]).toBe(target.id)
    expect(lineAccountIds(trainEntry)[0]).toBe(target.id)
  })

  it('統合元→統合先のペアごとに、名称のスナップショットと付け替え件数をaccount_merge_logへ1行記録する', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const train = repository.create({ category: 'expense', name: '電車賃', isReconcilable: null })
    spend(bus.id)
    spend(bus.id)
    spend(train.id)

    repository.merge(target.id, [bus.id, train.id])

    const logs = mergeLogs()
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({
      targetId: target.id, targetName: '交通費', sourceId: bus.id, sourceName: 'バス代', lineCount: 2,
    })
    expect(logs[1]).toMatchObject({ sourceId: train.id, sourceName: '電車賃', lineCount: 1 })
    expect(typeof logs[0].mergedAt).toBe('string')
  })

  it('仕訳が無い統合元も統合でき、付け替え件数0として記録される', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })

    repository.merge(target.id, [bus.id])

    expect(mergeLogs()[0]).toMatchObject({ sourceId: bus.id, lineCount: 0 })
  })

  it('統合後の統合元は仕訳が0件になり、物理削除できる。削除してもログは名称付きで残る', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    spend(bus.id)

    repository.merge(target.id, [bus.id])
    repository.delete(bus.id)

    expect(repository.findById(bus.id)).toBeNull()
    expect(mergeLogs()[0]).toMatchObject({ sourceId: null, sourceName: 'バス代', lineCount: 1 })
  })

  it('統合元を非アクティブ化しても過去の仕訳は統合先に付いたまま参照できる', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const entryId = spend(bus.id)

    repository.merge(target.id, [bus.id])
    repository.deactivate(bus.id)

    expect(lineAccountIds(entryId)[0]).toBe(target.id)
    expect(repository.findById(bus.id)!.isActive).toBe(false)
  })

  it('統合先が存在しなければ例外を投げ、何も変更しない', () => {
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const entryId = spend(bus.id)

    expect(() => repository.merge(99999, [bus.id])).toThrow()
    expect(lineAccountIds(entryId)[0]).toBe(bus.id)
    expect(mergeLogs()).toHaveLength(0)
  })

  it('統合元が存在しなければ例外を投げ、先に処理した統合元の付け替えもロールバックされる', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    const entryId = spend(bus.id)

    expect(() => repository.merge(target.id, [bus.id, 99999])).toThrow()
    expect(lineAccountIds(entryId)[0]).toBe(bus.id)
    expect(mergeLogs()).toHaveLength(0)
  })

  it('区分が異なる科目同士は統合できない', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const income = repository.create({ category: 'revenue', name: '雑収入', isReconcilable: null })

    expect(() => repository.merge(target.id, [income.id])).toThrow()
    expect(mergeLogs()).toHaveLength(0)
  })

  it('資産・負債は、照合可否が異なる科目同士では統合できない', () => {
    const reconcilable = repository.create({
      category: 'asset', name: '楽天銀行', isReconcilable: true, hasExternalStatement: true,
    })

    expect(() => repository.merge(reconcilable.id, [cashId])).toThrow()
    expect(mergeLogs()).toHaveLength(0)
  })

  it('統合先と同じ科目を統合元に含めることはできない', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })

    expect(() => repository.merge(target.id, [target.id])).toThrow()
  })

  it('統合元が空なら例外を投げる', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })

    expect(() => repository.merge(target.id, [])).toThrow()
  })

  it('システム管理科目は、統合元にも統合先にもできない', () => {
    seedInitialBalanceAccount(db)
    const system = repository.findAll().find((a) => a.isSystemManaged)!
    const other = repository.create({ category: system.category, name: '別の資本', isReconcilable: null, isSystemManaged: true })

    expect(() => repository.merge(other.id, [system.id])).toThrow()
    expect(() => repository.merge(system.id, [other.id])).toThrow()
  })

  it('非アクティブな科目は統合先にできない', () => {
    const target = repository.create({ category: 'expense', name: '交通費', isReconcilable: null })
    const bus = repository.create({ category: 'expense', name: 'バス代', isReconcilable: null })
    repository.deactivate(target.id)

    expect(() => repository.merge(target.id, [bus.id])).toThrow()
  })
})
