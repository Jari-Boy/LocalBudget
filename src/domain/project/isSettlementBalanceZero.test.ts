/**
 * isSettlementBalanceZero(非アクティブ化提案の判定ロジック)の
 * 純粋関数としてのユニットテスト。
 * docs/domain/projects.md 1.3節・1.5節の「精算残高の定義」
 * (kind='settlement'のプロジェクトに紐づく資産・負債科目それぞれの残高が
 * すべて0になった状態)を、資産のみ/負債のみ残高が残るケース・
 * 両方0のケース・紐づく資産負債科目が1件もない(未記帳)ケース・
 * kind='event'のプロジェクトが対象外であることを含め検証する。
 * DB非依存、外部依存なし(financial-statementドメインの
 * summarizeAccountsByCategoryをクロスドメインでimportする)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { Project } from './Project'
import { isSettlementBalanceZero } from './isSettlementBalanceZero'

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    category: 'expense',
    name: 'テスト科目',
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    initialBalanceForAccountId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(overrides: Partial<JournalEntry> & Pick<JournalEntry, 'lines'>): JournalEntry {
  return {
    id: 1,
    entryDate: '2026-07-01',
    memo: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 999,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function line(
  id: number,
  journalEntryId: number,
  accountId: number,
  side: 'debit' | 'credit',
  amount: number,
  projectId: number | null,
): JournalEntry['lines'][number] {
  return {
    id,
    journalEntryId,
    accountId,
    projectId,
    householdMemberId: null,
    counterpartyId: null,
    side,
    amount,
    createdAt: '2026-07-01T00:00:00.000Z',
  }
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 100,
    name: '26/7生活費割勘',
    kind: 'settlement',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const accounts: Account[] = [
  buildAccount({ id: 1, category: 'asset', name: '立替金(資産)' }),
  buildAccount({ id: 2, category: 'liability', name: '立替金(負債)' }),
  buildAccount({ id: 3, category: 'expense', name: '食費' }),
]

describe('isSettlementBalanceZero', () => {
  it('紐づく資産科目のみ残高が非ゼロの場合、精算未完了(false)と判定する', () => {
    const project = buildProject()
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [
          line(1, 1, 1, 'debit', 3000, 100),
          line(2, 1, 2, 'debit', 2000, 100),
          line(3, 1, 2, 'credit', 2000, 100),
        ],
      }),
    ]
    // 資産(id1): debit-credit=3000-0=3000(非ゼロ), 負債(id2): credit-debit=2000-2000=0(ゼロ)

    expect(isSettlementBalanceZero(project, entries, accounts)).toBe(false)
  })

  it('紐づく負債科目のみ残高が非ゼロの場合、精算未完了(false)と判定する', () => {
    const project = buildProject()
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [line(1, 1, 1, 'debit', 2000, 100), line(2, 1, 1, 'credit', 2000, 100), line(3, 1, 2, 'credit', 1500, 100)],
      }),
    ]
    // 資産(id1): debit-credit=2000-2000=0(ゼロ), 負債(id2): credit-debit=1500-0=1500(非ゼロ)

    expect(isSettlementBalanceZero(project, entries, accounts)).toBe(false)
  })

  it('紐づく資産・負債科目の残高が両方ゼロの場合、精算完了(true)と判定する', () => {
    const project = buildProject()
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [
          line(1, 1, 1, 'debit', 5000, 100),
          line(2, 1, 1, 'credit', 5000, 100),
          line(3, 1, 2, 'debit', 5000, 100),
          line(4, 1, 2, 'credit', 5000, 100),
        ],
      }),
    ]
    // 資産(id1): 5000-5000=0, 負債(id2): 5000-5000=0 → 両方ゼロ

    expect(isSettlementBalanceZero(project, entries, accounts)).toBe(true)
  })

  it('紐づく資産・負債科目の明細が1件もない(未記帳)場合、精算完了とは区別してfalseを返す', () => {
    const project = buildProject()
    const entries: JournalEntry[] = [
      buildEntry({ id: 1, lines: [line(1, 1, 3, 'debit', 1000, 200)] }), // 別プロジェクトの費用明細のみ
    ]

    expect(isSettlementBalanceZero(project, entries, accounts)).toBe(false)
  })

  it("kind='event'のプロジェクトは、資産・負債残高が両方ゼロでも対象外としてfalseを返す", () => {
    const project = buildProject({ kind: 'event' })
    const entries: JournalEntry[] = [
      buildEntry({
        id: 1,
        lines: [
          line(1, 1, 1, 'debit', 5000, 100),
          line(2, 1, 1, 'credit', 5000, 100),
          line(3, 1, 2, 'debit', 5000, 100),
          line(4, 1, 2, 'credit', 5000, 100),
        ],
      }),
    ]

    expect(isSettlementBalanceZero(project, entries, accounts)).toBe(false)
  })
})
