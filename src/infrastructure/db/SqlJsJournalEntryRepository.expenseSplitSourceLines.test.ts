/**
 * SqlJsJournalEntryRepositoryの割勘対象行の記録(expense_split_source_lines、計画Issue #271)に関する統合テスト。
 * 割勘仕訳の作成時に元の行idを同じトランザクションで保存すること、findExpenseSplitSourceLinksで読めること、
 * 割勘仕訳を削除すると記録も消えて割勘済みでなくなること、割勘済みの行の金額・科目・貸借の変更と削除
 * (行の削除・元の仕訳の削除)を拒否し、それ以外の項目の編集は許すことを検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsHouseholdMemberRepository } from './SqlJsHouseholdMemberRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { ExpenseSplitSourceLineLockedError } from '../../domain/journal/ExpenseSplitSourceLineLockedError'
import type { JournalEntry } from '../../domain/journal/JournalEntry'

let db: Database
let repository: SqlJsJournalEntryRepository
let foodId: number
let dailyId: number
let cashId: number
let advanceAssetId: number
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)
  memberId = new SqlJsHouseholdMemberRepository(db).create({ name: '自分' }).id
  foodId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  dailyId = accounts.create({ category: 'expense', name: '日用品', isReconcilable: null }).id
  cashId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  advanceAssetId = accounts.create({ category: 'asset', name: '立替', isReconcilable: false }).id
})

function createOriginal(): JournalEntry {
  return repository.create({
    householdMemberId: memberId,
    entryDate: '2026-11-01',
    lines: [
      { householdMemberId: memberId, accountId: foodId, side: 'debit', amount: 800 },
      { householdMemberId: memberId, accountId: dailyId, side: 'debit', amount: 200 },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 1000 },
    ],
  })
}

function createSplit(sourceLineIds: number[]): JournalEntry {
  return repository.create({
    householdMemberId: memberId,
    entryDate: '2026-11-02',
    sourceType: 'expense_splitting',
    expenseSplitSourceLineIds: sourceLineIds,
    lines: [
      { householdMemberId: memberId, accountId: advanceAssetId, side: 'debit', amount: 100 },
      { householdMemberId: memberId, accountId: cashId, side: 'credit', amount: 100 },
    ],
  })
}

describe('割勘対象行の記録', () => {
  it('割勘仕訳を作ると、元の行のidが記録されて読み出せる', () => {
    const original = createOriginal()
    const split = createSplit([original.lines[0].id])
    expect(repository.findExpenseSplitSourceLinks()).toEqual([{ splitEntryId: split.id, sourceLineId: original.lines[0].id }])
  })

  it('元の行のidを渡さない仕訳は記録を作らない', () => {
    createOriginal()
    expect(repository.findExpenseSplitSourceLinks()).toEqual([])
  })

  it('割勘仕訳を削除すると記録も消える(割勘済みでなくなる)', () => {
    const original = createOriginal()
    const split = createSplit([original.lines[0].id])
    repository.delete(split.id)
    expect(repository.findExpenseSplitSourceLinks()).toEqual([])
  })

  it('同じ元の行を、相手ごとの複数の割勘仕訳が参照できる', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    createSplit([original.lines[0].id])
    expect(repository.findExpenseSplitSourceLinks()).toHaveLength(2)
  })

  it('存在しない元の行のidを渡すと、仕訳も記録も作らず失敗する', () => {
    expect(() => createSplit([99999])).toThrow()
    expect(repository.findAll()).toEqual([])
  })
})

describe('割勘済みの行の保護', () => {
  it('割勘済みの行の金額を変えると拒否する', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    expect(() =>
      repository.update(original.id, {
        entryDate: original.entryDate,
        lines: original.lines.map((l) => ({ ...l, amount: l.id === original.lines[0].id ? 700 : l.amount === 1000 ? 900 : l.amount })),
      }),
    ).toThrow(ExpenseSplitSourceLineLockedError)
  })

  it('割勘済みの行の科目を変えると拒否する', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    expect(() =>
      repository.update(original.id, {
        entryDate: original.entryDate,
        lines: original.lines.map((l) => (l.id === original.lines[0].id ? { ...l, accountId: dailyId } : l)),
      }),
    ).toThrow(ExpenseSplitSourceLineLockedError)
  })

  it('割勘済みの行の貸借を変えると拒否する', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    expect(() =>
      repository.update(original.id, {
        entryDate: original.entryDate,
        // 貸借が合うように、現金の行も逆向き(借方600)にして、割勘済みの行の貸借だけが違反になるようにする
        lines: [
          { ...original.lines[0], side: 'credit' as const },
          original.lines[1],
          { ...original.lines[2], side: 'debit' as const, amount: 600 },
        ],
      }),
    ).toThrow(ExpenseSplitSourceLineLockedError)
  })

  it('割勘済みの行を削除する更新は拒否する', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    expect(() =>
      repository.update(original.id, {
        entryDate: original.entryDate,
        lines: [original.lines[1], { ...original.lines[2], amount: 200 }],
      }),
    ).toThrow(ExpenseSplitSourceLineLockedError)
  })

  it('割勘済みの行を持つ仕訳の削除は拒否する', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    expect(() => repository.delete(original.id)).toThrow(ExpenseSplitSourceLineLockedError)
    expect(repository.findById(original.id)).not.toBeNull()
  })

  it('割勘済みでない行の変更・削除や、日付・摘要・プロジェクトなどの編集は許す', () => {
    const original = createOriginal()
    createSplit([original.lines[0].id])
    const updated = repository.update(original.id, {
      entryDate: '2026-11-05',
      memo: '修正',
      lines: [
        original.lines[0],
        { ...original.lines[1], amount: 300 },
        { ...original.lines[2], amount: 1100 },
      ],
    })
    expect(updated.memo).toBe('修正')
    expect(updated.lines.find((l) => l.id === original.lines[1].id)?.amount).toBe(300)
  })

  it('割勘を取り消した(割勘仕訳を削除した)あとは、元の行を自由に編集・削除できる', () => {
    const original = createOriginal()
    const split = createSplit([original.lines[0].id])
    repository.delete(split.id)
    expect(() => repository.delete(original.id)).not.toThrow()
  })
})
