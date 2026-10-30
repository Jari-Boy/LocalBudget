/**
 * SqlJsJournalEntryRepository の行単位リンク(journal_entry_links、計画Issue #132)の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md 1.8・docs/domain/settlement.md
 * 1.6〜1.8・docs/schema/journal.sql に定義された、仕訳明細(journal_lines)同士を結ぶリンクの
 * 作成(createLink・create の links オプション)、作成時のハード検証(科目一致・貸借逆・世帯メンバー/
 * プロジェクト一致・from_line の金額上限)、仕訳更新(行idの差分更新)およびカスケード削除との整合を
 * 検証する。外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { JournalEntryLinkLineError } from '../../domain/journal/JournalEntryLinkLineError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'
import type { JournalEntry } from '../../domain/journal/JournalEntry'

let db: Database
let repository: SqlJsJournalEntryRepository
let memberId: number
let memberBId: number
let foodExpenseAccountId: number
let rentExpenseAccountId: number
let bankAccountId: number
let payableAccountId: number
let otherPayableAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)
  memberId = insertHouseholdMember(db, 'Aさん')
  memberBId = insertHouseholdMember(db, 'Bさん')

  foodExpenseAccountId = accounts.create({ category: 'expense', name: '食費', isReconcilable: null }).id
  rentExpenseAccountId = accounts.create({ category: 'expense', name: '家賃', isReconcilable: null }).id
  bankAccountId = accounts.create({ category: 'asset', name: '普通預金', isReconcilable: true }).id
  payableAccountId = accounts.create({ category: 'liability', name: '未払金', isReconcilable: false }).id
  otherPayableAccountId = accounts.create({ category: 'liability', name: '別の未払金', isReconcilable: false }).id
})

/** 家賃80,000円の暫定計上(借方: 家賃 / 貸方: 未払金)。貸方の未払金行[1]が消込先(to_line)になる */
function createRentAccrual(overrides?: { projectId?: number; householdMemberId?: number }): JournalEntry {
  return repository.create({
    householdMemberId: memberId,
    entryDate: '2026-07-01',
    memo: '家賃(暫定計上)',
    lines: [
      { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
      {
        accountId: payableAccountId,
        side: 'credit',
        amount: 80000,
        projectId: overrides?.projectId,
        householdMemberId: overrides?.householdMemberId,
      },
    ],
  })
}

/** 未払金の消込(借方: 未払金 / 貸方: 普通預金)。借方の未払金行[0]が消込元(from_line)になる */
function createSettlementEntry(
  amount: number,
  overrides?: { projectId?: number; householdMemberId?: number; accountId?: number },
): JournalEntry {
  return repository.create({
    householdMemberId: memberId,
    entryDate: '2026-07-05',
    memo: '家賃(消込)',
    sourceType: 'external_import',
    lines: [
      {
        accountId: overrides?.accountId ?? payableAccountId,
        side: 'debit',
        amount,
        projectId: overrides?.projectId,
        householdMemberId: overrides?.householdMemberId,
      },
      { accountId: bankAccountId, side: 'credit', amount },
    ],
  })
}

describe('createLink: settlesリンクのハード検証(settlement.md 1.8)', () => {
  it('消込元の行と消込先の一時勘定行が科目一致・貸借逆・タグ一致なら、行idと所属仕訳idを持つリンクを作成する', () => {
    const toEntry = createRentAccrual()
    const fromEntry = createSettlementEntry(80000)

    const link = repository.createLink({
      fromLineId: fromEntry.lines[0].id,
      toLineId: toEntry.lines[1].id,
      linkType: 'settles',
      amount: 80000,
    })

    expect(link).toMatchObject({
      fromLineId: fromEntry.lines[0].id,
      toLineId: toEntry.lines[1].id,
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'settles',
      amount: 80000,
    })
  })

  it('消込元と消込先の科目が異なる場合はSettlementTagMismatchErrorをスローし何も書き込まない', () => {
    const toEntry = createRentAccrual()
    const fromEntry = createSettlementEntry(80000, { accountId: otherPayableAccountId })

    expect(() =>
      repository.createLink({
        fromLineId: fromEntry.lines[0].id,
        toLineId: toEntry.lines[1].id,
        linkType: 'settles',
        amount: 80000,
      }),
    ).toThrow(SettlementTagMismatchError)

    expect(repository.listLinksForEntry(toEntry.id)).toHaveLength(0)
  })

  it('貸借が逆でない(同じ側同士の)行を結ぼうとするとSettlementTagMismatchErrorをスローする', () => {
    const toEntry = createRentAccrual()
    const sameSideEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-06',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 5000 },
        { accountId: payableAccountId, side: 'credit', amount: 5000 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromLineId: sameSideEntry.lines[1].id,
        toLineId: toEntry.lines[1].id,
        linkType: 'settles',
        amount: 5000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })

  it('世帯メンバーが一致しない場合はSettlementTagMismatchErrorをスローする', () => {
    const toEntry = createRentAccrual({ householdMemberId: memberId })
    const fromEntry = createSettlementEntry(80000, { householdMemberId: memberBId })

    expect(() =>
      repository.createLink({
        fromLineId: fromEntry.lines[0].id,
        toLineId: toEntry.lines[1].id,
        linkType: 'settles',
        amount: 80000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })

  it('プロジェクトが一致しない場合はSettlementTagMismatchErrorをスローする(精算バッチ廃止までの既存仕様)', () => {
    const projectId = insertProject(db, 'スマホ24回')
    const toEntry = createRentAccrual({ projectId })
    const fromEntry = createSettlementEntry(80000)

    expect(() =>
      repository.createLink({
        fromLineId: fromEntry.lines[0].id,
        toLineId: toEntry.lines[1].id,
        linkType: 'settles',
        amount: 80000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })

  it('消込先が一時勘定(is_reconcilable = falseの資産・負債)でない行の場合はSettlementTagMismatchErrorをスローする', () => {
    const rentEntry = createRentAccrual()
    const expenseCreditEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-06',
      lines: [
        { accountId: rentExpenseAccountId, side: 'credit', amount: 5000 },
        { accountId: payableAccountId, side: 'debit', amount: 5000 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromLineId: expenseCreditEntry.lines[0].id,
        toLineId: rentEntry.lines[0].id,
        linkType: 'settles',
        amount: 5000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })
})

describe('createLink: allocatesリンクの検証', () => {
  /** 元の食費(借方) 1,000円と、費用を付け替える割勘仕訳(費用の貸方行[0])を作る */
  function createOriginalAndSplit() {
    const original = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: bankAccountId, side: 'credit', amount: 1000 },
      ],
      sourceType: 'external_import',
    })
    const split = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-15',
      lines: [
        { accountId: foodExpenseAccountId, side: 'credit', amount: 500, householdMemberId: memberId },
        { accountId: payableAccountId, side: 'debit', amount: 500, householdMemberId: memberBId },
      ],
    })
    return { original, split }
  }

  it('科目一致・貸借逆の行同士ならallocatesリンクを作成できる(世帯メンバーが異なっていてもよい)', () => {
    const { original, split } = createOriginalAndSplit()

    const link = repository.createLink({
      fromLineId: split.lines[0].id,
      toLineId: original.lines[0].id,
      linkType: 'allocates',
      amount: 500,
    })

    expect(link).toMatchObject({ linkType: 'allocates', fromEntryId: split.id, toEntryId: original.id, amount: 500 })
  })

  it('科目が異なる行同士はJournalEntryLinkLineError(account_mismatch)をスローする', () => {
    const { original, split } = createOriginalAndSplit()

    const createMismatchedLink = () =>
      repository.createLink({
        fromLineId: split.lines[1].id,
        toLineId: original.lines[0].id,
        linkType: 'allocates',
        amount: 500,
      })

    expect(createMismatchedLink).toThrow(JournalEntryLinkLineError)
    expect(createMismatchedLink).toThrowError(expect.objectContaining({ reason: 'account_mismatch' }))
  })

  it('貸借が同じ側の行同士はJournalEntryLinkLineError(side_not_opposite)をスローする', () => {
    const { original } = createOriginalAndSplit()
    const sameSide = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-16',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: payableAccountId, side: 'credit', amount: 500 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromLineId: sameSide.lines[0].id,
        toLineId: original.lines[0].id,
        linkType: 'allocates',
        amount: 500,
      }),
    ).toThrowError(expect.objectContaining({ reason: 'side_not_opposite' }))
  })
})

describe('createLink: 共通の検証', () => {
  it('存在しない行idを指定するとJournalEntryLinkLineError(line_not_found)をスローする', () => {
    const toEntry = createRentAccrual()

    expect(() =>
      repository.createLink({ fromLineId: 999999, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 100 }),
    ).toThrowError(expect.objectContaining({ name: 'JournalEntryLinkLineError', reason: 'line_not_found' }))
  })

  it('1つのfrom_lineから出るリンクの金額合計がfrom_lineの金額を超える場合はamount_exceeds_from_lineで拒否し、金額ちょうどまでは許可する', () => {
    const toEntryA = createRentAccrual()
    const toEntryB = createRentAccrual()
    const fromEntry = createSettlementEntry(100000)
    const fromLineId = fromEntry.lines[0].id

    repository.createLink({ fromLineId, toLineId: toEntryA.lines[1].id, linkType: 'settles', amount: 80000 })
    // 80,000 + 20,000 = 100,000 = from_lineの金額ちょうど
    expect(() =>
      repository.createLink({ fromLineId, toLineId: toEntryB.lines[1].id, linkType: 'settles', amount: 20000 }),
    ).not.toThrow()
    // これ以上はfrom_lineの金額を超える
    expect(() =>
      repository.createLink({ fromLineId, toLineId: toEntryB.lines[1].id, linkType: 'settles', amount: 1 }),
    ).toThrowError(expect.objectContaining({ reason: 'amount_exceeds_from_line' }))
  })

  it('1件のto_lineに対する消込の累計が元の金額を超える過剰消込は許容される(settlement.md 1.6)', () => {
    const toEntry = createRentAccrual()
    const first = createSettlementEntry(80000)
    const second = createSettlementEntry(10000)

    repository.createLink({ fromLineId: first.lines[0].id, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 80000 })

    expect(() =>
      repository.createLink({ fromLineId: second.lines[0].id, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 10000 }),
    ).not.toThrow()
  })

  it('listLinksForEntryは、その仕訳の明細がfrom側・to側いずれのリンクも返し、存在しない仕訳には空配列を返す', () => {
    const toEntry = createRentAccrual()
    const fromEntry = createSettlementEntry(80000)
    const link = repository.createLink({
      fromLineId: fromEntry.lines[0].id,
      toLineId: toEntry.lines[1].id,
      linkType: 'settles',
      amount: 80000,
    })

    expect(repository.listLinksForEntry(toEntry.id).map((l) => l.id)).toEqual([link.id])
    expect(repository.listLinksForEntry(fromEntry.id).map((l) => l.id)).toEqual([link.id])
    expect(repository.listLinksForEntry(999999)).toHaveLength(0)
  })
})

describe('create: linksオプション(fromLineIndexで新しい仕訳の行を指す)による仕訳とリンクの同時書き込み', () => {
  it('消込仕訳の作成とsettlesリンクを1回の呼び出しで書き込み、リンクのfrom_lineは作成された行になる', () => {
    const toEntry = createRentAccrual()

    const fromEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
        { accountId: payableAccountId, side: 'debit', amount: 80000 },
      ],
      links: [{ fromLineIndex: 1, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 80000 }],
    })

    const links = repository.listLinksForEntry(fromEntry.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      fromLineId: fromEntry.lines[1].id,
      toLineId: toEntry.lines[1].id,
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'settles',
      amount: 80000,
    })
  })

  it('検証に失敗した場合は仕訳・明細・リンクをまとめてロールバックする', () => {
    const toEntry = createRentAccrual()
    const entryCountBefore = repository.findAll().length

    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-05',
        sourceType: 'external_import',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 80000 },
          { accountId: bankAccountId, side: 'credit', amount: 80000 },
        ],
        links: [{ fromLineIndex: 0, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 80000 }],
      }),
    ).toThrow(SettlementTagMismatchError)

    expect(repository.findAll()).toHaveLength(entryCountBefore)
    expect(repository.listLinksForEntry(toEntry.id)).toHaveLength(0)
  })

  it('fromLineIndexが行の範囲外の場合はline_not_foundで拒否し、何も書き込まない', () => {
    const toEntry = createRentAccrual()
    const entryCountBefore = repository.findAll().length

    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-05',
        sourceType: 'external_import',
        lines: [
          { accountId: payableAccountId, side: 'debit', amount: 80000 },
          { accountId: bankAccountId, side: 'credit', amount: 80000 },
        ],
        links: [{ fromLineIndex: 5, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 80000 }],
      }),
    ).toThrowError(expect.objectContaining({ reason: 'line_not_found' }))

    expect(repository.findAll()).toHaveLength(entryCountBefore)
  })

  it('1つの消込行から複数の元の行へ(1:N)まとめてリンクでき、合計がその行の金額を超える場合はロールバックする', () => {
    const toEntryA = createRentAccrual()
    const toEntryB = createRentAccrual()

    const settlement = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 150000 },
        { accountId: bankAccountId, side: 'credit', amount: 150000 },
      ],
      links: [
        { fromLineIndex: 0, toLineId: toEntryA.lines[1].id, linkType: 'settles', amount: 80000 },
        { fromLineIndex: 0, toLineId: toEntryB.lines[1].id, linkType: 'settles', amount: 70000 },
      ],
    })
    expect(repository.listLinksForEntry(settlement.id)).toHaveLength(2)

    const entryCountBefore = repository.findAll().length
    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-06',
        sourceType: 'external_import',
        lines: [
          { accountId: payableAccountId, side: 'debit', amount: 100000 },
          { accountId: bankAccountId, side: 'credit', amount: 100000 },
        ],
        links: [
          { fromLineIndex: 0, toLineId: toEntryA.lines[1].id, linkType: 'settles', amount: 80000 },
          { fromLineIndex: 0, toLineId: toEntryB.lines[1].id, linkType: 'settles', amount: 30000 },
        ],
      }),
    ).toThrowError(expect.objectContaining({ reason: 'amount_exceeds_from_line' }))
    expect(repository.findAll()).toHaveLength(entryCountBefore)
  })
})

describe('行単位リンクと仕訳更新(行idの差分更新)・削除の整合', () => {
  it('メモ・日付・金額のみを修正しても、リンクが付いた行のidが維持されリンクは削除されない', () => {
    const toEntry = createRentAccrual()
    const fromEntry = createSettlementEntry(80000)
    repository.createLink({
      fromLineId: fromEntry.lines[0].id,
      toLineId: toEntry.lines[1].id,
      linkType: 'settles',
      amount: 80000,
    })

    repository.update(toEntry.id, {
      entryDate: '2026-08-01',
      memo: '日付とメモと金額を修正',
      lines: [
        { id: toEntry.lines[0].id, accountId: rentExpenseAccountId, side: 'debit', amount: 85000 },
        { id: toEntry.lines[1].id, accountId: payableAccountId, side: 'credit', amount: 85000 },
      ],
    })

    const links = repository.listLinksForEntry(toEntry.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ toLineId: toEntry.lines[1].id, amount: 80000 })
  })

  it('行を削除する更新では、その行に紐づくリンクだけが削除され、他の行のリンクは残る', () => {
    const toEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 100000 },
        { accountId: payableAccountId, side: 'credit', amount: 60000, householdMemberId: memberId },
        { accountId: payableAccountId, side: 'credit', amount: 40000, householdMemberId: memberBId },
      ],
    })
    const settleA = createSettlementEntry(60000, { householdMemberId: memberId })
    const settleB = createSettlementEntry(40000, { householdMemberId: memberBId })
    repository.createLink({ fromLineId: settleA.lines[0].id, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 60000 })
    repository.createLink({ fromLineId: settleB.lines[0].id, toLineId: toEntry.lines[2].id, linkType: 'settles', amount: 40000 })

    repository.update(toEntry.id, {
      entryDate: '2026-07-01',
      lines: [
        { id: toEntry.lines[0].id, accountId: rentExpenseAccountId, side: 'debit', amount: 60000 },
        { id: toEntry.lines[1].id, accountId: payableAccountId, side: 'credit', amount: 60000, householdMemberId: memberId },
      ],
    })

    const remaining = repository.listLinksForEntry(toEntry.id)
    expect(remaining.map((link) => link.toLineId)).toEqual([toEntry.lines[1].id])
    expect(repository.listLinksForEntry(settleB.id)).toHaveLength(0)
  })

  it('同じ仕訳に世帯メンバーの異なる一時勘定行が複数あっても、リンクは行ごとに独立して記録される(#40・#110の制約が不要になる)', () => {
    const toEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 100000 },
        { accountId: payableAccountId, side: 'credit', amount: 60000, householdMemberId: memberId },
        { accountId: payableAccountId, side: 'credit', amount: 40000, householdMemberId: memberBId },
      ],
    })
    const settleB = createSettlementEntry(40000, { householdMemberId: memberBId })

    // Bさんの債務(行[2])だけを消し込む。Aさんの債務(行[1])は影響を受けない
    repository.createLink({ fromLineId: settleB.lines[0].id, toLineId: toEntry.lines[2].id, linkType: 'settles', amount: 40000 })
    // Aさんの行を、Bさんの精算で消し込もうとするとタグ(世帯メンバー)不一致で拒否される
    expect(() =>
      repository.createLink({ fromLineId: settleB.lines[0].id, toLineId: toEntry.lines[1].id, linkType: 'settles', amount: 1 }),
    ).toThrow(SettlementTagMismatchError)

    expect(repository.listLinksForEntry(toEntry.id).map((link) => link.toLineId)).toEqual([toEntry.lines[2].id])
  })

  it('仕訳の削除でその明細に紐づくリンクがカスケード削除される(to側・from側いずれの仕訳でも)', () => {
    const toEntry = createRentAccrual()
    const fromEntry = createSettlementEntry(80000)
    repository.createLink({
      fromLineId: fromEntry.lines[0].id,
      toLineId: toEntry.lines[1].id,
      linkType: 'settles',
      amount: 80000,
    })

    repository.delete(toEntry.id)

    expect(countLinks(db)).toBe(0)
    expect(repository.findById(fromEntry.id)).not.toBeNull()
  })
})

function countLinks(database: Database): number {
  return database.exec('SELECT COUNT(*) AS c FROM journal_entry_links')[0].values[0][0] as number
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function insertProject(database: Database, name: string): number {
  database.run(`INSERT INTO projects (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
