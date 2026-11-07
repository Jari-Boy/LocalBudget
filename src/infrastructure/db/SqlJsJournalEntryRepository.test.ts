/**
 * SqlJsJournalEntryRepository の統合テスト。
 * sql.js(SQLite WASM)をNode上で実際に動かし、docs/domain/journal.md・docs/schema/journal.sql
 * に定義された仕訳(JournalEntry)・仕訳明細(JournalLine)の作成・参照・更新(行idによる差分更新、
 * 計画Issue #132)・削除(物理削除)、貸借バランス検証(不一致時は書き込まずUnbalancedJournalEntryErrorを投げる)、
 * is_reconcilable資産・負債への記帳がsource_typeによらず許可されること(docs/domain/reconciliation.md 1.2、
 * 計画Issue #145で直接記帳制限を廃止)、FK制約有効化によるDB側エラー時のロールバック保証を検証する。
 * 外部依存: sql.js(ネットワークアクセスなし)。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'sql.js'
import { createTestDatabase } from './createTestDatabase'
import { runMigrations } from './migrations'
import { SqlJsAccountRepository } from './SqlJsAccountRepository'
import { SqlJsJournalEntryRepository } from './SqlJsJournalEntryRepository'
import { UnbalancedJournalEntryError } from '../../domain/journal/UnbalancedJournalEntryError'
import { SettlementBatchOnNonTemporaryAccountError } from '../../domain/journal/SettlementBatchOnNonTemporaryAccountError'

let db: Database
let repository: SqlJsJournalEntryRepository
let cashAccountId: number
let foodExpenseAccountId: number
let miscExpenseAccountId: number
let bankAccountId: number
let rentExpenseAccountId: number
let payableAccountId: number
/** 起票者(計画Issue #88)。本ファイルの大半のテストは起票者自体を検証対象としないため、
 * 共通の1件を使い回す(科目既定値強制の検証はSqlJsJournalEntryRepository.householdMemberDefault.test.ts参照) */
let memberId: number

beforeEach(async () => {
  db = await createTestDatabase()
  runMigrations(db)
  const accounts = new SqlJsAccountRepository(db)
  repository = new SqlJsJournalEntryRepository(db)
  memberId = insertHouseholdMember(db, '自分')

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
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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
        householdMemberId: memberId,
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
      householdMemberId: memberId,
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
        householdMemberId: memberId,
        entryDate: '2026-07-27',
        lines: [],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
  })

  it('明細1件のみでの作成はUnbalancedJournalEntryErrorをスローし何も書き込まない(journal.md 1.1: 2件以上の不変条件)', () => {
    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-27',
        lines: [{ accountId: foodExpenseAccountId, side: 'debit', amount: 1000 }],
      }),
    ).toThrow(UnbalancedJournalEntryError)

    expect(repository.findAll()).toHaveLength(0)
    expect(countJournalLines(db)).toBe(0)
  })

  it('明細0件への更新はUnbalancedJournalEntryErrorをスローし元の明細を変更しない', () => {
    const created = repository.create({
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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

describe('is_reconcilable資産・負債への記帳(計画Issue #145で直接記帳制限を廃止)', () => {
  it.each([
    'manual',
    'recurring_generated',
    'external_import',
    'initial_balance',
    'balance_adjustment',
  ] as const)('sourceTypeが%sでもis_reconcilable科目への記帳を許可する', (sourceType) => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-24',
      sourceType,
      lines: [
        { accountId: bankAccountId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(created.sourceType).toBe(sourceType)
    expect(countJournalLines(db)).toBe(2)
  })

  it('manual仕訳をis_reconcilable科目への記帳に更新できる', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-24',
      sourceType: 'manual',
      lines: [
        { accountId: cashAccountId, side: 'debit', amount: 1000 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    const updated = repository.update(created.id, {
      entryDate: '2026-07-24',
      lines: [
        { id: created.lines[0].id, accountId: bankAccountId, side: 'debit', amount: 1000 },
        { id: created.lines[1].id, accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(updated.lines.map((l) => l.accountId)).toEqual(
      expect.arrayContaining([bankAccountId, foodExpenseAccountId]),
    )
  })
})

describe('source_type = expense_splitting(計画Issue #149)', () => {
  it('割勘仕訳としてexpense_splittingで保存でき、読み出しても値が保たれる', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-24',
      sourceType: 'expense_splitting',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: foodExpenseAccountId, side: 'credit', amount: 500 },
      ],
    })

    expect(repository.findById(created.id)?.sourceType).toBe('expense_splitting')
  })
})

describe('findAll', () => {
  it('作成した全ての仕訳を返す', () => {
    repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: cashAccountId, side: 'credit', amount: 2000 },
      ],
    })

    expect(repository.findAll()).toHaveLength(2)
  })
})

/**
 * 更新対象の仕訳より後に別の仕訳を作成する。SQLiteはINTEGER PRIMARY KEYがAUTOINCREMENTでない場合、
 * 削除した行が採番の末尾だと同じidを再利用してしまうため、対象の明細が採番の末尾にならないよう
 * 「後続の仕訳」を用意しておく。これがないと、全削除→再挿入という旧実装でも偶然idが一致し、
 * 行idの維持を検証するテストが意図どおりに失敗(red)しない。
 */
function createLaterEntry(): void {
  repository.create({
    householdMemberId: memberId,
    entryDate: '2026-12-31',
    lines: [
      { accountId: miscExpenseAccountId, side: 'debit', amount: 1 },
      { accountId: cashAccountId, side: 'credit', amount: 1 },
    ],
  })
}

describe('update(行idによる差分更新、計画Issue #132)', () => {
  it('全明細をid未指定で差し替えjournal_entries.updated_atを更新する', () => {
    const created = repository.create({
      householdMemberId: memberId,
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

  it('id未指定の行は新規挿入として扱い、既存の行は削除される(明細idは引き継がれない)', () => {
    const created = repository.create({
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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

  it('idを指定した既存行は同じidのままUPDATEされ、日付・メモ・金額・科目の変更が反映される', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      memo: '更新前',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const [debitLine, creditLine] = created.lines
    createLaterEntry()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-20',
      memo: '更新後',
      lines: [
        { id: debitLine.id, accountId: miscExpenseAccountId, side: 'debit', amount: 1500 },
        { id: creditLine.id, accountId: cashAccountId, side: 'credit', amount: 1500 },
      ],
    })

    expect(updated.lines.map((line) => line.id)).toEqual([debitLine.id, creditLine.id])
    expect(updated.lines[0]).toMatchObject({ accountId: miscExpenseAccountId, amount: 1500 })
    expect(updated.lines[1]).toMatchObject({ accountId: cashAccountId, amount: 1500 })
    expect(updated.entryDate).toBe('2026-07-20')
    expect(updated.memo).toBe('更新後')
  })

  it('id指定の行にprojectId等の任意項目を設定・解除でき、idは変わらない', () => {
    const projectId = insertProject(db, '旅行')
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000, projectId },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const [debitLine, creditLine] = created.lines
    createLaterEntry()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-12',
      lines: [
        { id: debitLine.id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000, projectId: null },
        { id: creditLine.id, accountId: cashAccountId, side: 'credit', amount: 1000, householdMemberId: memberId },
      ],
    })

    expect(updated.lines[0]).toMatchObject({ id: debitLine.id, projectId: null })
    expect(updated.lines[1]).toMatchObject({ id: creditLine.id, householdMemberId: memberId })
  })

  it('id未指定の行は新規INSERTされ、既存の行のidは維持される', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const [debitLine, creditLine] = created.lines
    createLaterEntry()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-12',
      lines: [
        { id: debitLine.id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { id: creditLine.id, accountId: cashAccountId, side: 'credit', amount: 700 },
        { accountId: payableAccountId, side: 'credit', amount: 300 },
      ],
    })

    expect(updated.lines).toHaveLength(3)
    expect(updated.lines.slice(0, 2).map((line) => line.id)).toEqual([debitLine.id, creditLine.id])
    expect([debitLine.id, creditLine.id]).not.toContain(updated.lines[2].id)
  })

  it('入力から消えた既存行はDELETEされる', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 600 },
        { accountId: miscExpenseAccountId, side: 'debit', amount: 400 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const [foodLine, miscLine, cashLine] = created.lines
    createLaterEntry()

    const updated = repository.update(created.id, {
      entryDate: '2026-07-12',
      lines: [
        { id: foodLine.id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { id: cashLine.id, accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(updated.lines.map((line) => line.id)).toEqual([foodLine.id, cashLine.id])
    expect(updated.lines.map((line) => line.id)).not.toContain(miscLine.id)
  })

  it('他の仕訳に属する明細idを指定するとエラーをスローし、何も書き込まない', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      memo: '更新前',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    const other = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-13',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 500 },
        { accountId: cashAccountId, side: 'credit', amount: 500 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-12',
        memo: '更新後',
        lines: [
          { id: other.lines[0].id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
          { id: created.lines[1].id, accountId: cashAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()

    expect(repository.findById(created.id)).toEqual(created)
    expect(repository.findById(other.id)).toEqual(other)
  })

  it('同じ明細idを複数の入力行で指定するとエラーをスローし、何も書き込まない', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-12',
        lines: [
          { id: created.lines[0].id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
          { id: created.lines[0].id, accountId: cashAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()

    expect(repository.findById(created.id)).toEqual(created)
  })

  it('UPDATE中にDB制約違反が起きた場合はトランザクション全体をロールバックし、既存行のidと内容を保つ', () => {
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-12',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })

    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-12',
        lines: [
          { id: created.lines[0].id, accountId: 99999, side: 'debit', amount: 1000 },
          { id: created.lines[1].id, accountId: cashAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow()

    expect(repository.findById(created.id)).toEqual(created)
  })
})

describe('DB制約違反時のロールバック(FK制約有効化)', () => {
  it('存在しない科目を参照する明細を含む作成はトランザクション全体をロールバックする', () => {
    expect(() =>
      repository.create({
        householdMemberId: memberId,
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
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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
      householdMemberId: memberId,
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

describe('deleteBySettlementBatchId(settlement_batch_id単位での一括物理削除、計画Issue #133)', () => {
  it('対象settlement_batch_idにタグ付けされた仕訳が複数件ある場合はまとめて物理削除する', () => {
    const batchId = insertSettlementBatch(db, '旅行2026')
    const entryA = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: payableAccountId, side: 'credit', amount: 1000, settlementBatchId: batchId },
      ],
    })
    const entryB = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: payableAccountId, side: 'credit', amount: 2000, settlementBatchId: batchId },
      ],
    })

    repository.deleteBySettlementBatchId(batchId)

    expect(repository.findById(entryA.id)).toBeNull()
    expect(repository.findById(entryB.id)).toBeNull()
  })

  it('対象settlement_batch_idを持つ仕訳が0件の場合は何もせず正常終了する', () => {
    const batchId = insertSettlementBatch(db, '空バッチ')
    const other = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-03',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 300 },
        { accountId: cashAccountId, side: 'credit', amount: 300 },
      ],
    })

    expect(() => repository.deleteBySettlementBatchId(batchId)).not.toThrow()
    expect(repository.findById(other.id)).not.toBeNull()
  })

  it('別のsettlement_batch_idを持つ仕訳やsettlement_batch_idが未設定の仕訳は削除されない', () => {
    const targetBatchId = insertSettlementBatch(db, '対象バッチ')
    const otherBatchId = insertSettlementBatch(db, '別バッチ')

    const target = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: payableAccountId, side: 'credit', amount: 1000, settlementBatchId: targetBatchId },
      ],
    })
    const other = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-02',
      lines: [
        { accountId: miscExpenseAccountId, side: 'debit', amount: 2000 },
        { accountId: payableAccountId, side: 'credit', amount: 2000, settlementBatchId: otherBatchId },
      ],
    })
    const untagged = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-03',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 300 },
        { accountId: cashAccountId, side: 'credit', amount: 300 },
      ],
    })

    repository.deleteBySettlementBatchId(targetBatchId)

    expect(repository.findById(target.id)).toBeNull()
    expect(repository.findById(other.id)).not.toBeNull()
    expect(repository.findById(untagged.id)).not.toBeNull()
  })

  it('精算済み(同一settlement_batch_idへの精算行を持つ)仕訳が混在していてもガードなくすべて削除される(回帰テスト)', () => {
    const batchId = insertSettlementBatch(db, 'スマホ24回')
    const toEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: rentExpenseAccountId, side: 'debit', amount: 80000 },
        { accountId: payableAccountId, side: 'credit', amount: 80000, settlementBatchId: batchId },
      ],
    })
    const fromEntry = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-05',
      sourceType: 'external_import',
      lines: [
        { accountId: payableAccountId, side: 'debit', amount: 80000, settlementBatchId: batchId },
        { accountId: bankAccountId, side: 'credit', amount: 80000 },
      ],
    })

    expect(() => repository.deleteBySettlementBatchId(batchId)).not.toThrow()
    expect(repository.findById(toEntry.id)).toBeNull()
    expect(repository.findById(fromEntry.id)).toBeNull()
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

function insertSettlementBatch(database: Database, name: string): number {
  database.run(`INSERT INTO settlement_batches (name, type) VALUES (?, 'expense_splitting')`, [name])
  return lastInsertRowId(database)
}

function lastInsertRowId(database: Database): number {
  return database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number
}

describe('仕訳コメント(comment、計画Issue #144)', () => {
  function createWithComment(comment?: string | null) {
    return repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      memo: '摘要',
      ...(comment === undefined ? {} : { comment }),
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
  }

  function toKeptLines(entry: ReturnType<typeof createWithComment>) {
    return entry.lines.map((line) => ({ id: line.id, accountId: line.accountId, side: line.side, amount: line.amount }))
  }

  it('commentを指定して作成すると保存され、摘要(memo)とは別に取得できる', () => {
    const created = createWithComment('割勘の相手に後で確認する')
    expect(repository.findById(created.id)?.comment).toBe('割勘の相手に後で確認する')
    expect(repository.findById(created.id)?.memo).toBe('摘要')
  })

  it('commentを省略して作成するとnullになる', () => {
    expect(createWithComment().comment).toBeNull()
  })

  it('updateでcommentを変更できる', () => {
    const created = createWithComment('変更前')
    const updated = repository.update(created.id, {
      entryDate: '2026-07-01',
      memo: '摘要',
      comment: '変更後',
      lines: toKeptLines(created),
    })
    expect(updated.comment).toBe('変更後')
  })

  it('updateでcommentを指定しない場合は既存のコメントを維持する', () => {
    const created = createWithComment('維持される')
    const updated = repository.update(created.id, {
      entryDate: '2026-07-01',
      memo: '摘要変更',
      lines: toKeptLines(created),
    })
    expect(updated.comment).toBe('維持される')
  })

  it('updateでcommentにnullを指定するとコメントを消去できる', () => {
    const created = createWithComment('消す')
    const updated = repository.update(created.id, {
      entryDate: '2026-07-01',
      comment: null,
      lines: toKeptLines(created),
    })
    expect(updated.comment).toBeNull()
  })
})

describe('精算バッチタグは一時勘定の行にのみ設定できる(計画Issue #144)', () => {
  it('一時勘定(未払金)の行にはタグを設定して作成できる', () => {
    const batchId = insertSettlementBatch(db, 'バッチ')
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: payableAccountId, side: 'credit', amount: 1000, settlementBatchId: batchId },
      ],
    })
    expect(created.lines.map((line) => line.settlementBatchId)).toEqual([null, batchId])
  })

  it('費用科目の行にタグを設定して作成しようとすると、書き込まずSettlementBatchOnNonTemporaryAccountErrorを投げる', () => {
    const batchId = insertSettlementBatch(db, 'バッチ')
    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-01',
        lines: [
          { accountId: foodExpenseAccountId, side: 'debit', amount: 1000, settlementBatchId: batchId },
          { accountId: cashAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(SettlementBatchOnNonTemporaryAccountError)
    expect(repository.findAll()).toHaveLength(0)
  })

  it('is_reconcilable = trueの口座科目の行にタグを設定した作成も拒否する(external_importでも同様)', () => {
    const batchId = insertSettlementBatch(db, 'バッチ')
    expect(() =>
      repository.create({
        householdMemberId: memberId,
        entryDate: '2026-07-01',
        sourceType: 'external_import',
        lines: [
          { accountId: bankAccountId, side: 'debit', amount: 1000, settlementBatchId: batchId },
          { accountId: foodExpenseAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(SettlementBatchOnNonTemporaryAccountError)
  })

  it('updateで一時勘定以外の行にタグを設定しようとすると拒否し、既存の内容を変更しない', () => {
    const batchId = insertSettlementBatch(db, 'バッチ')
    const created = repository.create({
      householdMemberId: memberId,
      entryDate: '2026-07-01',
      memo: '更新前',
      lines: [
        { accountId: foodExpenseAccountId, side: 'debit', amount: 1000 },
        { accountId: cashAccountId, side: 'credit', amount: 1000 },
      ],
    })
    expect(() =>
      repository.update(created.id, {
        entryDate: '2026-07-01',
        memo: '更新後',
        lines: [
          { id: created.lines[0].id, accountId: foodExpenseAccountId, side: 'debit', amount: 1000, settlementBatchId: batchId },
          { id: created.lines[1].id, accountId: cashAccountId, side: 'credit', amount: 1000 },
        ],
      }),
    ).toThrow(SettlementBatchOnNonTemporaryAccountError)
    expect(repository.findById(created.id)?.memo).toBe('更新前')
  })
})
