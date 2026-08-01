/**
 * SqlJsJournalEntryRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md・docs/schema/journal.sql
 * に定義された仕訳(JournalEntry)・仕訳明細(JournalLine)の作成・参照・更新(明細行の全差し替え)・
 * 削除(物理削除)、貸借バランス検証(不一致時は書き込まずUnbalancedJournalEntryErrorを投げる)、
 * is_reconcilable資産・負債への直接記帳制限(docs/domain/reconciliation.md 1.2、不一致時は
 * RestrictedAccountPostingErrorを投げる)、FK制約有効化によるDB側エラー時のロールバック保証を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { RestrictedAccountPostingError } from '../../domain/journal/RestrictedAccountPostingError'
import { SettlementTagMismatchError } from '../../domain/journal/SettlementTagMismatchError'

let db: Database
let repository: SqlJsJournalEntryRepository
let cashAccountId: number
let foodExpenseAccountId: number
let miscExpenseAccountId: number
let bankAccountId: number
let rentExpenseAccountId: number
let payableAccountId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)

  cashAccountId = accounts.create({ category: 'asset', name: '現金', isReconcilable: false }).id
  foodExpenseAccountId = accounts.create({
    category: 'expense',
    name: '食費',
    isReconcilable: null,
  }).id
  miscExpenseAccountId = accounts.create({
    category: 'expense',
    name: '日用品費',
    isReconcilable: null,
  }).id
  bankAccountId = accounts.create({
    category: 'asset',
    name: '普通預金',
    isReconcilable: true,
  }).id
  rentExpenseAccountId = accounts.create({
    category: 'expense',
    name: '家賃',
    isReconcilable: null,
  }).id
  payableAccountId = accounts.create({
    category: 'liability',
    name: '未払金',
    isReconcilable: false,
  }).id
})

describe('create / findById', () => {
  it('貸借バランスの取れた仕訳をヘッダー・明細付きで作成しidで参照できる', () => {
    const created = repository.create({
      entryDate: '2026-07-20',
      memo: 'スーパーで食材購入',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    const found = repository.findById(created.id)

    expect(found?.entryDate).toBe('2026-07-20')
    expect(found?.memo).toBe('スーパーで食材購入')
    expect(found?.currency).toBe('JPY')
    expect(found?.sourceType).toBe('manual')
    expect(found?.lines).toHaveLength(2)
    expect(
      found?.lines.map((l) => ({ accountId: l.accountId, side: l.side, amount: l.amount })),
    ).toEqual(
      expect.arrayContaining([
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ]),
    )
  })

  it('存在しないidに対してはnullを返す', () => {
    expect(repository.findById(9999)).toBeNull()
  })

  it('複数の費用科目に分割された複合仕訳を作成する', () => {
    const created = repository.create({
      entryDate: '2026-07-21',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 7000 },
        { accountId: miscExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 10000 },
      ],
    })

    expect(repository.findById(created.id)?.lines).toHaveLength(3)
  })

  it('明細行の任意項目projectId/householdMemberId/counterpartyIdを保存・復元できる', () => {
    const memberId = insertHouseholdMember(db, '夫')
    const projectId = insertProject(db, '旅行2026')
    const revenueAccountId = new SqlJsAccountRepository(db).create({
      category: 'revenue',
      name: '副業収入',
      isReconcilable: null,
    }).id
    const counterpartyId = insertCounterparty(db, '取引先A')

    const created = repository.create({
      entryDate: '2026-07-23',
      lines: [
        { accountId: cashAccountId, side: 'debit', amount: 5000 },
        {
          accountId: revenueAccountId,
          side: 'credit',
          amount: 5000,
          projectId,
          householdMemberId: memberId,
          counterpartyId,
        },
      ],
    })

    const creditLine = repository
      .findById(created.id)
      ?.lines.find((l) => l.side === 'credit')

    expect(creditLine).toMatchObject({
      accountId: revenueAccountId,
      projectId,
      householdMemberId: memberId,
      counterpartyId,
    })
  })
})

describe('貸借バランス検証', () => {
  it('貸借不一致の仕訳作成はUnbalancedJournalEntryErrorをスローし何も書き込まない', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
          { accountId: cashAccountId, side: 'credit', amount: 2000 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('貸借不一致な明細セットへの更新はUnbalancedJournalEntryErrorをスローし元の明細を変更しない', () => {
    const created = repository.create({
      entryDate: '2026-07-22',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-22',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 5000 },
          { accountId: cashAccountId, side: 'credit', amount: 3000 },
        ],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines).toHaveLength(2)
    expect(
      stillOriginal?.lines.find((l) => l.accountId === foodExpenseAccountId)?.amount,
    ).toBe(3000)
  })

  it('明細0件での作成はUnbalancedJournalEntryErrorをスローし何も書き込まない(journal.md 1.1: 2件以上の不変条件)', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-27',
        lines: [],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
  })

  it('明細1件のみでの作成はUnbalancedJournalEntryErrorをスローし何も書き込まない(journal.md 1.1: 2件以上の不変条件)', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-27',
        lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('明細0件への更新はUnbalancedJournalEntryErrorをスローし元の明細を変更しない', () => {
    const created = repository.create({
      entryDate: '2026-07-28',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1500 },
        { accountId: cashAccountId, side: 'credit', amount: 1500 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-28',
        lines: [],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findById(created.id)?.lines).toHaveLength(2)
  })

  it('明細1件のみへの更新はUnbalancedJournalEntryErrorをスローし元の明細を変更しない', () => {
    const created = repository.create({
      entryDate: '2026-07-29',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1200 },
        { accountId: cashAccountId, side: 'credit', amount: 1200 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-29',
        lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1200 }],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines).toHaveLength(2)
    expect(stillOriginal?.lines.map((l) => l.accountId)).toEqual(
      expect.arrayContaining([foodExpenseAccountId, cashAccountId]),
    )
  })
})

describe('is_reconcilable資産・負債への直接記帳制限(reconciliation.md 1.2)', () => {
  it('is_reconcilable科目に記帳するmanual仕訳の作成はRestrictedAccountPostingErrorをスローし何も書き込まない', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-24',
        sourceType: 'manual',
        lines: [
          { accountId: bankAccountId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(RestrictedAccountPostingError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('is_reconcilable科目に記帳するrecurring_generated仕訳もRestrictedAccountPostingErrorをスローする', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-24',
        sourceType: 'recurring_generated',
        lines: [
          { accountId: bankAccountId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(RestrictedAccountPostingError)
  })

  it.each(['external_import', 'initial_balance', 'balance_adjustment'] as const)(
    'sourceTypeが%sの場合はis_reconcilable科目への記帳を許可する',
    (sourceType) => {
      const created = repository.create({
        entryDate: '2026-07-24',
        sourceType,
        lines: [
          { accountId: bankAccountId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      })

      expect(created.sourceType).toBe(sourceType)
    },
  )

  it('non-is_reconcilable科目のみに記帳するmanual仕訳は許可される', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-24',
        sourceType: 'manual',
        lines: [
          { accountId: cashAccountId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).not.toThrow()
  })

  it('manual仕訳をis_reconcilable科目への記帳に更新するとRestrictedAccountPostingErrorをスローし元の明細を変更しない', () => {
    const created = repository.create({
      entryDate: '2026-07-24',
      sourceType: 'manual',
      lines: [
        { accountId: cashAccountId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-24',
        lines: [
          { accountId: bankAccountId, side: 'debit', amount: 1000 },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(RestrictedAccountPostingError)

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines.map((l) => l.accountId)).toEqual(
      expect.arrayContaining([cashAccountId, foodExpenseAccountId]),
    )
  })
})

describe('findAll', () => {
  it('作成した全ての仕訳を返す', () => {
    repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(repository.findAll()).toHaveLength(2)
  })
})

describe('update(明細行の全差し替え)', () => {
  it('全明細を差し替えjournal_entries.updated_atを更新する', () => {
    const created = repository.create({
      entryDate: '2026-07-10',
      memo: '当初の内容',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    // 更新によってupdated_atが変わることを、時計を待たずに確認するため
    // 固定の過去日時を直接セットしておく
    db.run(`UPDATE journal_entries SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`, [
      created.id,
    ])

    const updated = repository.update(created.id, {
      entryDate: '2026-07-11',
      memo: '差し替え後の内容',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 4000 },
        { accountId: cashAccountId, side: 'credit', amount: 4000 },
      ],
    })

    expect(updated.entryDate).toBe('2026-07-11')
    expect(updated.memo).toBe('差し替え後の内容')
    expect(updated.lines).toHaveLength(2)
    expect(updated.lines.map((l) => l.accountId)).toEqual(
      expect.arrayContaining([miscExpenseAccountId, cashAccountId]),
    )
    expect(updated.lines.some((l) => l.accountId === foodExpenseAccountId)).toBe(false)
    expect(updated.updatedAt).not.toBe('2000-01-01 00:00:00')
  })

  it('既存のjournal_lines行を新規挿入行に差し替える(更新をまたいで明細idは保持されない)', () => {
    const created = repository.create({
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    // journal_linesテーブルが更新対象の仕訳の行だけで完全に空にならないよう、
    // 他の仕訳もあらかじめ作成しておく(SQLiteはINTEGER PRIMARY KEYがAUTOINCREMENTでない場合、
    // テーブルが完全に空になると採番を1から再開するため、他の行が存在しない状態だと
    // 偶然idが一致してしまい、この検証の意図が成立しない)
    repository.create({
      entryDate: '2026-07-13',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
    })
    const originalLineIds = created.lines.map((l) => l.id).sort()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const newLineIds = updated.lines.map((l) => l.id).sort()

    expect(newLineIds).not.toEqual(originalLineIds)
    for (const id of originalLineIds) {
      expect(newLineIds).not.toContain(id)
    }
  })
})

describe('DB制約違反時のロールバック(FK制約有効化)', () => {
  it('存在しない科目を参照する明細を含む作成はトランザクション全体をロールバックする', () => {
    expect(() =>
      repository.create({
        entryDate: '2026-07-25',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
          { accountId: 999999, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('存在しない科目を参照する明細を含む更新はトランザクション全体をロールバックする', () => {
    const created = repository.create({
      entryDate: '2026-07-26',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-26',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 2000 },
          { accountId: 999999, side: 'credit', amount: 2000 },
        ],
      }),
    ).toThrow()

    const stillOriginal = repository.findById(created.id)
    expect(stillOriginal?.lines).toHaveLength(2)
    expect(stillOriginal?.lines.every((l) => l.accountId !== 999999)).toBe(true)
  })
})

describe('delete', () => {
  it('仕訳を物理削除し明細もカスケード削除する', () => {
    const created = repository.create({
      entryDate: '2026-07-05',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
    })

    repository.delete(created.id)

    expect(repository.findById(created.id)).toBeNull()
    expect(countJournalLines(db)).toBe(0)
  })

  it('external_import仕訳の削除は常に許可される', () => {
    const created = repository.create({
      entryDate: '2026-07-06',
      sourceType: 'external_import',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 800 },
        { accountId: cashAccountId, side: 'credit', amount: 800 },
      ],
    })

    expect(() => repository.delete(created.id)).not.toThrow()
    expect(repository.findById(created.id)).toBeNull()
  })
})

describe('deleteByProjectId(project_id単位での一括物理削除、expense-splitting.md 1.2)', () => {
  it('対象project_idにタグ付けされた仕訳が複数件ある場合はまとめて物理削除する', () => {
    const projectId = insertProject(db, '旅行2026')
    const entryA = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: payableAccountId, side: 'credit', amount: 1000, projectId },
      ],
    })
    const entryB = repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: payableAccountId, side: 'credit', amount: 2000, projectId },
      ],
    })

    repository.deleteByProjectId(projectId)

    expect(repository.findById(entryA.id)).toBeNull()
    expect(repository.findById(entryB.id)).toBeNull()
  })

  it('対象project_idを持つ仕訳が0件の場合は何もせず正常終了する', () => {
    const projectId = insertProject(db, '空プロジェクト')
    const other = repository.create({
      entryDate: '2026-07-03',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 300 },
        { accountId: cashAccountId, side: 'credit', amount: 300 },
      ],
    })

    expect(() => repository.deleteByProjectId(projectId)).not.toThrow()
    expect(repository.findById(other.id)).not.toBeNull()
  })

  it('削除された仕訳のjournal_entry_links(from_entry/to_entryいずれの向きでも)もCASCADE削除される', () => {
    const projectId = insertProject(db, '按分対象')
    const original = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const taggedFromEntry = repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: payableAccountId, side: 'credit', amount: 500, projectId },
      ],
      links: [{ toEntryId: original.id, linkType: 'allocates', amount: 500 }],
    })

    const untagged = repository.create({
      entryDate: '2026-07-03',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const taggedToEntry = repository.create({
      entryDate: '2026-07-04',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000, projectId },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })
    repository.createLink({
      fromEntryId: untagged.id,
      toEntryId: taggedToEntry.id,
      linkType: 'allocates',
      amount: 80000,
    })

    repository.deleteByProjectId(projectId)

    expect(repository.findById(taggedFromEntry.id)).toBeNull()
    expect(repository.findById(taggedToEntry.id)).toBeNull()
    expect(repository.findById(original.id)).not.toBeNull()
    expect(repository.findById(untagged.id)).not.toBeNull()
    expect(repository.listLinksForEntry(original.id)).toHaveLength(0)
    expect(repository.listLinksForEntry(untagged.id)).toHaveLength(0)
  })

  it('別のproject_idを持つ仕訳やproject_idが未設定の仕訳は削除されない', () => {
    const targetProjectId = insertProject(db, '対象プロジェクト')
    const otherProjectId = insertProject(db, '別プロジェクト')

    const target = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: payableAccountId, side: 'credit', amount: 1000, projectId: targetProjectId },
      ],
    })
    const other = repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: payableAccountId, side: 'credit', amount: 2000, projectId: otherProjectId },
      ],
    })
    const untagged = repository.create({
      entryDate: '2026-07-03',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 300 },
        { accountId: cashAccountId, side: 'credit', amount: 300 },
      ],
    })

    repository.deleteByProjectId(targetProjectId)

    expect(repository.findById(target.id)).toBeNull()
    expect(repository.findById(other.id)).not.toBeNull()
    expect(repository.findById(untagged.id)).not.toBeNull()
  })

  it('精算済み(settlesリンクを持つ)仕訳が混在していてもガードなくすべて削除される(回帰テスト)', () => {
    const projectId = insertProject(db, 'スマホ24回')
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000, projectId },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000, projectId },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
      links: [{ toEntryId: toEntry.id, linkType: 'settles', amount: 80000 }],
    })

    expect(() => repository.deleteByProjectId(projectId)).not.toThrow()
    expect(repository.findById(toEntry.id)).toBeNull()
    expect(repository.findById(fromEntry.id)).toBeNull()
  })
})

describe('journal_entry_links(仕訳間の関係、journal.md 1.8・2.3)', () => {
  it('消込仕訳側に一致する一時勘定行がある場合はsettlesリンクを作成する', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      memo: '家賃(暫定計上)',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      memo: '家賃(消込)',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })

    const link = repository.createLink({
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'settles',
      amount: 80000,
    })

    expect(link.linkType).toBe('settles')
    expect(link.fromEntryId).toBe(fromEntry.id)
    expect(link.toEntryId).toBe(toEntry.id)
    expect(link.amount).toBe(80000)
  })

  it('消込仕訳側に一致する科目行がない場合はSettlementTagMismatchErrorをスローし何も書き込まない', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromEntryId: fromEntry.id,
        toEntryId: toEntry.id,
        linkType: 'settles',
        amount: 80000,
      }),
    ).toThrow(SettlementTagMismatchError)

    expect(repository.listLinksForEntry(toEntry.id)).toHaveLength(0)
  })

  it('project_id/household_member_idが一致しない場合はSettlementTagMismatchErrorをスローする', () => {
    const projectId = insertProject(db, 'スマホ24回')
    const otherProjectId = insertProject(db, 'タブレット12回')
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 10000, projectId },
        { accountId: payableAccountId, side: 'credit', amount: 10000, projectId },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 10000, projectId: otherProjectId },
        { accountId: bankAccountId, side: 'credit', amount: 10000 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromEntryId: fromEntry.id,
        toEntryId: toEntry.id,
        linkType: 'settles',
        amount: 10000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })

  it('一致する行の金額がリンク金額を下回る場合はSettlementTagMismatchErrorをスローする', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 5000 },
        { accountId: bankAccountId, side: 'credit', amount: 5000 },
      ],
    })

    expect(() =>
      repository.createLink({
        fromEntryId: fromEntry.id,
        toEntryId: toEntry.id,
        linkType: 'settles',
        amount: 80000,
      }),
    ).toThrow(SettlementTagMismatchError)
  })

  it('allocatesリンクはsettlesのハード検証を受けずに許可される', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 3000 },
        { accountId: cashAccountId, side: 'credit', amount: 3000 },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 1500 },
        { accountId: cashAccountId, side: 'credit', amount: 1500 },
      ],
    })

    const link = repository.createLink({
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'allocates',
      amount: 1500,
    })

    expect(link.linkType).toBe('allocates')
  })

  it('その仕訳がfrom_entry/to_entryいずれかであるリンクを一覧取得する', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const link = repository.createLink({
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'settles',
      amount: 80000,
    })

    expect(repository.listLinksForEntry(toEntry.id).map((l) => l.id)).toEqual([link.id])
    expect(repository.listLinksForEntry(fromEntry.id).map((l) => l.id)).toEqual([link.id])
    expect(repository.listLinksForEntry(999999)).toHaveLength(0)
  })
})

describe('create(linksオプションによる消込仕訳自体の作成とsettlesリンクの同時書き込み)', () => {
  it('タグが一致する場合は消込仕訳自体とsettlesリンクを1回の呼び出しで作成する', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      memo: '家賃(暫定計上)',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })

    const fromEntry = repository.create({
      entryDate: '2026-07-05',
      memo: '家賃(消込)',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000 },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
      links: [{ toEntryId: toEntry.id, linkType: 'settles', amount: 80000 }],
    })

    expect(fromEntry.lines).toHaveLength(2)
    const links = repository.listLinksForEntry(fromEntry.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      fromEntryId: fromEntry.id,
      toEntryId: toEntry.id,
      linkType: 'settles',
      amount: 80000,
    })
  })

  it('settlesのハード検証に失敗した場合は仕訳・明細・リンクをまとめてロールバックする', () => {
    const toEntry = repository.create({
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000 },
      ],
    })
    const entryCountBefore = repository.findAll().length

    expect(() =>
      repository.create({
        entryDate: '2026-07-05',
        sourceType: 'external_import',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 80000 },
          { accountId: bankAccountId, side: 'credit', amount: 80000 },
        ],
        links: [{ toEntryId: toEntry.id, linkType: 'settles', amount: 80000 }],
      }),
    ).toThrow(SettlementTagMismatchError)

    expect(repository.findAll()).toHaveLength(entryCountBefore)
    expect(repository.listLinksForEntry(toEntry.id)).toHaveLength(0)
  })

  it('allocatesリンクも同様に、割勘仕訳自体の作成と1回の呼び出しでまとめて書き込める(docs/domain/expense-splitting.md 1.3節)', () => {
    const originalEntry = repository.create({
      entryDate: '2026-07-01',
      memo: '食費(A)',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    const splitEntry = repository.create({
      entryDate: '2026-07-15',
      memo: '食費割勘',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
      links: [{ toEntryId: originalEntry.id, linkType: 'allocates', amount: 500 }],
    })

    expect(splitEntry.lines).toHaveLength(2)
    const links = repository.listLinksForEntry(splitEntry.id)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      fromEntryId: splitEntry.id,
      toEntryId: originalEntry.id,
      linkType: 'allocates',
      amount: 500,
    })
  })
})

function countJournalLines(database: Database): number {
  return database.exec('SELECT COUNT(*) AS c FROM journal_lines')[0].values[0][0] as number
}

function insertHouseholdMember(database: Database, name: string): number {
  database.run(`INSERT INTO household_members (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function insertProject(database: Database, name: string): number {
  database.run(`INSERT INTO projects (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function insertCounterparty(database: Database, name: string): number {
  database.run(`INSERT INTO counterparties (name) VALUES (?)`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}
