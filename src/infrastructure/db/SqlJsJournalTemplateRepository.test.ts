/**
 * SqlJsJournalTemplateRepository の統合テスト(計画Issue #201、docs/domain/journal-templates.md、
 * docs/schema/journal_templates.sql)。仕訳テンプレートの作成・参照・更新・削除・有効/無効と、
 * 行(科目・金額・取引先等)の保存、金額が空欄の行を許す検証(全行の金額があるときだけ貸借の一致を確認)、
 * 名称の一意、PL科目以外への取引先の指定拒否、精算バッチの付けられる科目の限定、
 * 書き込みが途中で失敗したときに何も残らないこと(原子性)を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsJournalTemplateRepository } from './SqlJsJournalTemplateRepository'
import { InvalidJournalTemplateError } from '../../domain/journal-template/InvalidJournalTemplateError'
import { SettlementBatchOnNonAdvanceAccountError } from '../../domain/journal/SettlementBatchOnNonAdvanceAccountError'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'

let db: Database
let repository: SqlJsJournalTemplateRepository
let expenseId: number
let assetId: number
let counterpartyId: number
let memberId: number

function lastId(): number {
  return db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

function insertAccount(category: string, name: string): number {
  // 資産・負債は照合の有無が必須、それ以外はNULL(accountsのCHECK制約)
  const reconcilable = category === 'asset' || category === 'liability' ? 0 : null
  db.run('INSERT INTO accounts (category, name, is_reconcilable) VALUES (?, ?, ?)', [category, name, reconcilable])
  return lastId()
}

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  repository = new SqlJsJournalTemplateRepository(db)
  expenseId = insertAccount('expense', '食費')
  assetId = insertAccount('asset', '現金')
  db.run(`INSERT INTO counterparties (name) VALUES ('ローソン')`)
  counterpartyId = lastId()
  db.run(`INSERT INTO household_members (name) VALUES ('自分')`)
  memberId = lastId()
})

const blankLines = () => [
  { side: 'debit' as const, accountId: expenseId, amount: null },
  { side: 'credit' as const, accountId: assetId, amount: null },
]

describe('create / findById / findAll', () => {
  it('金額が空欄の行を持つテンプレートを作成できる', () => {
    const created = repository.create({ name: 'コンビニ(昼食)', memo: '昼食', lines: blankLines() })

    expect(repository.findById(created.id)).toMatchObject({
      name: 'コンビニ(昼食)',
      memo: '昼食',
      bookkeeperHouseholdMemberId: null,
      groupId: null,
      isActive: true,
      lines: [
        { lineNo: 1, side: 'debit', accountId: expenseId, amount: null },
        { lineNo: 2, side: 'credit', accountId: assetId, amount: null },
      ],
    })
  })

  it('取引先・世帯メンバー・起票者を保存できる', () => {
    const created = repository.create({
      name: 'ローソン',
      bookkeeperHouseholdMemberId: memberId,
      lines: [
        { side: 'debit', accountId: expenseId, amount: null, counterpartyId, householdMemberId: memberId },
        { side: 'credit', accountId: assetId, amount: null },
      ],
    })

    expect(created.bookkeeperHouseholdMemberId).toBe(memberId)
    expect(created.lines[0]).toMatchObject({ counterpartyId, householdMemberId: memberId })
  })

  it('全行の金額を指定すると、貸借が一致していれば保存できる', () => {
    const created = repository.create({
      name: 'ジム',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 8800 },
        { side: 'credit', accountId: assetId, amount: 8800 },
      ],
    })

    expect(created.lines.map((l) => l.amount)).toEqual([8800, 8800])
  })

  it('一部の行だけ金額を指定した場合は、貸借の一致を確認しない', () => {
    const created = repository.create({
      name: '一部固定',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 500 },
        { side: 'credit', accountId: assetId, amount: null },
      ],
    })

    expect(created.lines.map((l) => l.amount)).toEqual([500, null])
  })

  it('findAllは全件をid順で返し、存在しないidはnullを返す', () => {
    repository.create({ name: 'A', lines: blankLines() })
    repository.create({ name: 'B', lines: blankLines() })

    expect(repository.findAll().map((t) => t.name)).toEqual(['A', 'B'])
    expect(repository.findById(999)).toBeNull()
  })
})

describe('検証', () => {
  it('全行の金額があって貸借が一致しないときはUnbalancedJournalEntryErrorで拒否する', () => {
    expect(() =>
      repository.create({
        name: '不一致',
        lines: [
          { side: 'debit', accountId: expenseId, amount: 1000 },
          { side: 'credit', accountId: assetId, amount: 900 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)
  })

  it('行が2行未満のときはInvalidJournalTemplateErrorで拒否する', () => {
    expect(() =>
      repository.create({ name: '1行', lines: [{ side: 'debit', accountId: expenseId, amount: null }] }),
    ).toThrow(InvalidJournalTemplateError)
  })

  it('借方か貸方のどちらかしかないときはInvalidJournalTemplateErrorで拒否する', () => {
    expect(() =>
      repository.create({
        name: '片側のみ',
        lines: [
          { side: 'debit', accountId: expenseId, amount: null },
          { side: 'debit', accountId: assetId, amount: null },
        ],
      }),
    ).toThrow(InvalidJournalTemplateError)
  })

  it('金額は正の整数でなければならない(0・負・小数は拒否する)', () => {
    for (const amount of [0, -1, 1.5]) {
      expect(() =>
        repository.create({
          name: `金額${amount}`,
          lines: [
            { side: 'debit', accountId: expenseId, amount },
            { side: 'credit', accountId: assetId, amount: null },
          ],
        }),
      ).toThrow(InvalidJournalTemplateError)
    }
  })

  it('名称が空白だけのときはInvalidJournalTemplateErrorで拒否する', () => {
    expect(() => repository.create({ name: '  ', lines: blankLines() })).toThrow(InvalidJournalTemplateError)
  })

  it('同じ名称のテンプレートは作成できない', () => {
    repository.create({ name: 'A', lines: blankLines() })

    expect(() => repository.create({ name: 'A', lines: blankLines() })).toThrow()
  })

  it('PL科目以外の行に取引先は指定できない', () => {
    expect(() =>
      repository.create({
        name: '取引先NG',
        lines: [
          { side: 'debit', accountId: expenseId, amount: null },
          { side: 'credit', accountId: assetId, amount: null, counterpartyId },
        ],
      }),
    ).toThrow()
  })

  it('精算バッチは立替金・未払金(システム管理の資産・負債)以外の行に付けられない', () => {
    expect(() =>
      repository.create({
        name: 'バッチNG',
        lines: [
          { side: 'debit', accountId: expenseId, amount: null, settlementBatchId: 1 },
          { side: 'credit', accountId: assetId, amount: null },
        ],
      }),
    ).toThrow(SettlementBatchOnNonAdvanceAccountError)
  })

  it('検証に失敗した書き込みは、テンプレートも行も残さない', () => {
    expect(() =>
      repository.create({
        name: '失敗',
        lines: [
          { side: 'debit', accountId: expenseId, amount: null },
          { side: 'credit', accountId: assetId, amount: null, counterpartyId },
        ],
      }),
    ).toThrow()

    expect(repository.findAll()).toEqual([])
    expect(db.exec('SELECT COUNT(*) FROM journal_template_lines')[0].values[0][0]).toBe(0)
  })
})

describe('update / delete / deactivate / activate', () => {
  it('名称・摘要・行をまとめて更新できる', () => {
    const created = repository.create({ name: 'A', lines: blankLines() })

    const updated = repository.update(created.id, {
      name: 'B',
      memo: 'メモ',
      lines: [
        { side: 'debit', accountId: expenseId, amount: 300 },
        { side: 'credit', accountId: assetId, amount: 300 },
      ],
    })

    expect(updated).toMatchObject({ name: 'B', memo: 'メモ' })
    expect(updated.lines.map((l) => l.amount)).toEqual([300, 300])
  })

  it('省略した項目は現在の値のままで、memoをnullにすると消去される', () => {
    const created = repository.create({ name: 'A', memo: '昼食', lines: blankLines() })

    expect(repository.update(created.id, { name: 'A2' }).memo).toBe('昼食')
    expect(repository.update(created.id, { memo: null }).memo).toBeNull()
    expect(repository.findById(created.id)!.lines).toHaveLength(2)
  })

  it('グループと並び順を変更できる', () => {
    const created = repository.create({ name: 'A', lines: blankLines() })
    db.run(`INSERT INTO journal_template_groups (name, sort_order) VALUES ('食事', 0)`)
    const groupId = lastId()

    const updated = repository.update(created.id, { groupId, sortOrder: 7 })

    expect(updated).toMatchObject({ groupId, sortOrder: 7 })
  })

  it('更新の検証に失敗したら、元の内容が残る', () => {
    const created = repository.create({ name: 'A', lines: blankLines() })

    expect(() =>
      repository.update(created.id, {
        lines: [
          { side: 'debit', accountId: expenseId, amount: 1000 },
          { side: 'credit', accountId: assetId, amount: 1 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findById(created.id)!.lines.map((l) => l.amount)).toEqual([null, null])
  })

  it('削除すると行も消える', () => {
    const created = repository.create({ name: 'A', lines: blankLines() })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
    expect(db.exec('SELECT COUNT(*) FROM journal_template_lines')[0].values[0][0]).toBe(0)
  })

  it('無効にして有効に戻せる', () => {
    const created = repository.create({ name: 'A', lines: blankLines() })

    expect(repository.deactivate(created.id).isActive).toBe(false)
    expect(repository.activate(created.id).isActive).toBe(true)
  })
})
