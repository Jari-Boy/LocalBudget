/**
 * filterJournalEntries(仕訳の複数軸絞り込み)の純粋関数としてのユニットテスト。
 * 期間(dateFrom/dateTo)・科目(accountId)・世帯メンバー(householdMemberId、明細行の世帯メンバーと
 * 直接比較、計画Issue #169)・プロジェクト(projectId)の4軸をAND条件で組み合わせて仕訳を絞り込む
 * ロジックを検証する(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * 計画Issue #145で追加した条件(摘要・金額の範囲・取引先・精算バッチ(未割当を含む)・作成経路・
 * 複数選択・グループ指定(配下すべて))を、個別・AND・別々の明細行での充足・入れ子グループの展開の
 * 観点で検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../account/Account'
import type { JournalEntry } from './JournalEntry'
import { filterJournalEntries } from './filterJournalEntries'

function buildAccount(id: number, overrides?: Partial<Account>): Account {
  return {
    id,
    category: 'expense',
    name: `科目${id}`,
    isReconcilable: null,
    isActive: true,
    isSystemManaged: false,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildEntry(overrides: {
  id: number
  entryDate: string
  householdMemberId?: number
  memo?: string | null
  sourceType?: JournalEntry['sourceType']
  lines?: {
    accountId: number
    projectId?: number | null
    householdMemberId?: number | null
    counterpartyId?: number | null
    settlementBatchId?: number | null
    side?: 'debit' | 'credit'
    amount?: number
  }[]
}): JournalEntry {
  return {
    id: overrides.id,
    entryDate: overrides.entryDate,
    memo: overrides.memo ?? null,
    comment: null,
    currency: 'JPY',
    sourceType: overrides.sourceType ?? 'manual',
    householdMemberId: overrides.householdMemberId ?? 1,
    generatedFromRuleId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    lines: (overrides.lines ?? [{ accountId: 10 }]).map((line, index) => ({
      id: overrides.id * 10 + index,
      journalEntryId: overrides.id,
      accountId: line.accountId,
      projectId: line.projectId ?? null,
      householdMemberId: line.householdMemberId ?? overrides.householdMemberId ?? 1,
      counterpartyId: line.counterpartyId ?? null,
      settlementBatchId: line.settlementBatchId ?? null,
      side: line.side ?? ('debit' as const),
      amount: line.amount ?? 1000,
      createdAt: '2026-08-01T00:00:00.000Z',
    })),
  }
}

describe('filterJournalEntries', () => {
  it('フィルタ条件を何も指定しない場合、全件を返す', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-08-01' }), buildEntry({ id: 2, entryDate: '2026-08-02' })]

    const result = filterJournalEntries(entries, [], {})

    expect(result).toEqual(entries)
  })

  it('dateFromで、指定日より前の仕訳を除外する', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-07-31' }), buildEntry({ id: 2, entryDate: '2026-08-01' })]

    const result = filterJournalEntries(entries, [], { dateFrom: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([2])
  })

  it('dateToで、指定日より後の仕訳を除外する', () => {
    const entries = [buildEntry({ id: 1, entryDate: '2026-08-01' }), buildEntry({ id: 2, entryDate: '2026-08-02' })]

    const result = filterJournalEntries(entries, [], { dateTo: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('accountIdで、いずれの明細行にも一致する科目を含まない仕訳を除外する', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 20 }] }),
    ]

    const result = filterJournalEntries(entries, [], { accountId: 10 })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('projectIdで、いずれの明細行にも一致するプロジェクトを含まない仕訳を除外する', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 5 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 6 }] }),
    ]

    const result = filterJournalEntries(entries, [], { projectId: 5 })

    expect(result.map((e) => e.id)).toEqual([1])
  })

  it('householdMemberIdで、明細行の世帯メンバーが一致しない仕訳を除外する(科目の既定値・起票者は使わない、計画Issue #169)', () => {
    const accounts = [buildAccount(10, { householdMemberId: 100 }), buildAccount(20)]
    const entries = [
      // 科目10に既定メンバー100があっても、判定するのは明細行自身の世帯メンバー(200)
      buildEntry({
        id: 1,
        entryDate: '2026-08-01',
        householdMemberId: 999,
        lines: [{ accountId: 10, householdMemberId: 200 }],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-08-01',
        householdMemberId: 999,
        lines: [{ accountId: 20, householdMemberId: 300 }],
      }),
    ]

    expect(filterJournalEntries(entries, accounts, { householdMemberId: 300 }).map((e) => e.id)).toEqual([2])
    expect(filterJournalEntries(entries, accounts, { householdMemberId: 100 })).toEqual([])
    expect(filterJournalEntries(entries, accounts, { householdMemberId: 999 })).toEqual([])
  })

  it('複数軸を同時に指定した場合、AND条件で絞り込む', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 5 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 6 }] }),
      buildEntry({ id: 3, entryDate: '2026-07-01', lines: [{ accountId: 10, projectId: 5 }] }),
    ]

    const result = filterJournalEntries(entries, [], { accountId: 10, projectId: 5, dateFrom: '2026-08-01' })

    expect(result.map((e) => e.id)).toEqual([1])
  })
})

describe('filterJournalEntries: 拡張した条件(計画Issue #145)', () => {
  const ids = (entries: JournalEntry[]) => entries.map((e) => e.id)

  describe('摘要(memo)', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', memo: 'スーパーで食材' }),
      buildEntry({ id: 2, entryDate: '2026-08-02', memo: 'コンビニ' }),
      buildEntry({ id: 3, entryDate: '2026-08-03', memo: null }),
    ]

    it('摘要に指定した文字列を含む仕訳(部分一致)だけを返す', () => {
      expect(ids(filterJournalEntries(entries, [], { memo: 'スーパー' }))).toEqual([1])
    })

    it('英字の大文字・小文字を区別しない', () => {
      const english = [buildEntry({ id: 1, entryDate: '2026-08-01', memo: 'Amazon Prime' })]

      expect(ids(filterJournalEntries(english, [], { memo: 'amazon' }))).toEqual([1])
    })

    it('摘要が無い仕訳は、摘要を指定すると除外される', () => {
      expect(ids(filterJournalEntries(entries, [], { memo: '食' }))).not.toContain(3)
    })

    it('空文字・空白だけの指定は絞り込みなしとして扱う', () => {
      expect(ids(filterJournalEntries(entries, [], { memo: '  ' }))).toEqual([1, 2, 3])
    })
  })

  describe('金額の範囲(仕訳の金額 = 借方合計)', () => {
    const entries = [
      buildEntry({
        id: 1,
        entryDate: '2026-08-01',
        lines: [
          { accountId: 10, side: 'debit', amount: 300 },
          { accountId: 11, side: 'debit', amount: 200 },
          { accountId: 12, side: 'credit', amount: 500 },
        ],
      }),
      buildEntry({
        id: 2,
        entryDate: '2026-08-02',
        lines: [
          { accountId: 10, side: 'debit', amount: 5000 },
          { accountId: 12, side: 'credit', amount: 5000 },
        ],
      }),
    ]

    it('amountMin以上の仕訳だけを返す(借方の合計で判定する)', () => {
      expect(ids(filterJournalEntries(entries, [], { amountMin: 500 }))).toEqual([1, 2])
      expect(ids(filterJournalEntries(entries, [], { amountMin: 501 }))).toEqual([2])
    })

    it('amountMax以下の仕訳だけを返す', () => {
      expect(ids(filterJournalEntries(entries, [], { amountMax: 500 }))).toEqual([1])
    })

    it('amountMinとamountMaxを両方指定すると範囲(両端を含む)で絞り込む', () => {
      expect(ids(filterJournalEntries(entries, [], { amountMin: 500, amountMax: 5000 }))).toEqual([1, 2])
      expect(ids(filterJournalEntries(entries, [], { amountMin: 600, amountMax: 4000 }))).toEqual([])
    })
  })

  describe('複数選択(科目・世帯メンバー・プロジェクト・取引先)', () => {
    it('accountIdsはいずれかの科目を含む仕訳を返す(軸の内側はOR)', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
        buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 11 }] }),
        buildEntry({ id: 3, entryDate: '2026-08-01', lines: [{ accountId: 12 }] }),
      ]

      expect(ids(filterJournalEntries(entries, [], { accountIds: [10, 12] }))).toEqual([1, 3])
    })

    it('householdMemberIdsはいずれかの明細行の世帯メンバーに一致する仕訳を返す', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', householdMemberId: 1 }),
        buildEntry({ id: 2, entryDate: '2026-08-01', householdMemberId: 2 }),
        buildEntry({ id: 3, entryDate: '2026-08-01', householdMemberId: 3 }),
      ]

      expect(ids(filterJournalEntries(entries, [buildAccount(10)], { householdMemberIds: [2, 3] }))).toEqual([2, 3])
    })

    it('projectIdsはいずれかのプロジェクトを含む仕訳を返す', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 7 }] }),
        buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId: 8 }] }),
        buildEntry({ id: 3, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      ]

      expect(ids(filterJournalEntries(entries, [], { projectIds: [7, 8] }))).toEqual([1, 2])
    })

    it('counterpartyIds(取引先)はいずれかの取引先を含む仕訳を返す', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, counterpartyId: 5 }] }),
        buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, counterpartyId: 6 }] }),
        buildEntry({ id: 3, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      ]

      expect(ids(filterJournalEntries(entries, [], { counterpartyIds: [5] }))).toEqual([1])
      expect(ids(filterJournalEntries(entries, [], { counterpartyIds: [5, 6] }))).toEqual([1, 2])
    })

    it('空配列の指定は絞り込みなしとして扱う', () => {
      const entries = [buildEntry({ id: 1, entryDate: '2026-08-01' })]

      expect(ids(filterJournalEntries(entries, [], { accountIds: [], counterpartyIds: [], sourceTypes: [] }))).toEqual([1])
    })
  })

  describe('精算バッチ(未割当を含む)', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10, settlementBatchId: 3 }] }),
      buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10, settlementBatchId: 4 }] }),
      buildEntry({ id: 3, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      buildEntry({
        id: 4,
        entryDate: '2026-08-01',
        lines: [{ accountId: 10 }, { accountId: 11, settlementBatchId: 3 }],
      }),
    ]

    it('指定した精算バッチのタグが付いた明細を持つ仕訳を返す', () => {
      expect(ids(filterJournalEntries(entries, [], { settlementBatchIds: [3] }))).toEqual([1, 4])
    })

    it('複数の精算バッチを指定するといずれかに一致する仕訳を返す', () => {
      expect(ids(filterJournalEntries(entries, [], { settlementBatchIds: [3, 4] }))).toEqual([1, 2, 4])
    })

    it('nullは「未割当」(精算バッチのタグが付いた明細が1行も無い仕訳)を表す', () => {
      expect(ids(filterJournalEntries(entries, [], { settlementBatchIds: [null] }))).toEqual([3])
    })

    it('未割当と特定のバッチを同時に指定すると、どちらかに当たる仕訳を返す', () => {
      expect(ids(filterJournalEntries(entries, [], { settlementBatchIds: [null, 4] }))).toEqual([2, 3])
    })
  })

  describe('作成経路(source_type)', () => {
    const entries = [
      buildEntry({ id: 1, entryDate: '2026-08-01', sourceType: 'manual' }),
      buildEntry({ id: 2, entryDate: '2026-08-01', sourceType: 'external_import' }),
      buildEntry({ id: 3, entryDate: '2026-08-01', sourceType: 'expense_splitting' }),
      buildEntry({ id: 4, entryDate: '2026-08-01', sourceType: 'recurring_generated' }),
    ]

    it('指定した作成経路の仕訳だけを返す', () => {
      expect(ids(filterJournalEntries(entries, [], { sourceTypes: ['external_import'] }))).toEqual([2])
    })

    it('複数の作成経路を指定するといずれかに一致する仕訳を返す(割勘を含む)', () => {
      expect(ids(filterJournalEntries(entries, [], { sourceTypes: ['manual', 'expense_splitting'] }))).toEqual([1, 3])
    })
  })

  describe('グループ指定(配下すべてを対象)', () => {
    const accounts = [
      buildAccount(10, { accountGroupId: 1 }),
      buildAccount(11, { accountGroupId: 2 }),
      buildAccount(12, { accountGroupId: 3 }),
      buildAccount(13, { accountGroupId: null }),
    ]
    const accountGroups = [
      { id: 1, parentGroupId: null },
      { id: 2, parentGroupId: 1 },
      { id: 3, parentGroupId: 2 },
    ]

    it('accountGroupIdsは配下(入れ子を含む)のグループに属する科目を含む仕訳をすべて返す', () => {
      const entries = [10, 11, 12, 13].map((accountId, index) =>
        buildEntry({ id: index + 1, entryDate: '2026-08-01', lines: [{ accountId }] }),
      )

      expect(ids(filterJournalEntries(entries, accounts, { accountGroupIds: [1] }, { accountGroups }))).toEqual([1, 2, 3])
      expect(ids(filterJournalEntries(entries, accounts, { accountGroupIds: [2] }, { accountGroups }))).toEqual([2, 3])
    })

    it('counterpartyGroupIdsは配下の取引先グループに属する取引先を含む仕訳を返す', () => {
      const counterparties = [
        { id: 5, counterpartyGroupId: 1 },
        { id: 6, counterpartyGroupId: 2 },
        { id: 7, counterpartyGroupId: null },
      ]
      const counterpartyGroups = [
        { id: 1, parentGroupId: null },
        { id: 2, parentGroupId: 1 },
      ]
      const entries = [5, 6, 7].map((counterpartyId, index) =>
        buildEntry({ id: index + 1, entryDate: '2026-08-01', lines: [{ accountId: 10, counterpartyId }] }),
      )

      expect(
        ids(filterJournalEntries(entries, accounts, { counterpartyGroupIds: [1] }, { counterparties, counterpartyGroups })),
      ).toEqual([1, 2])
    })

    it('projectGroupIdsは配下のプロジェクトグループに属するプロジェクトを含む仕訳を返す', () => {
      const projects = [
        { id: 7, projectGroupId: 1 },
        { id: 8, projectGroupId: 2 },
        { id: 9, projectGroupId: null },
      ]
      const projectGroups = [
        { id: 1, parentGroupId: null },
        { id: 2, parentGroupId: 1 },
      ]
      const entries = [7, 8, 9].map((projectId, index) =>
        buildEntry({ id: index + 1, entryDate: '2026-08-01', lines: [{ accountId: 10, projectId }] }),
      )

      expect(ids(filterJournalEntries(entries, accounts, { projectGroupIds: [2] }, { projects, projectGroups }))).toEqual([2])
      expect(ids(filterJournalEntries(entries, accounts, { projectGroupIds: [1] }, { projects, projectGroups }))).toEqual([1, 2])
    })
  })

  describe('複数条件の組み合わせ(AND)と、別々の明細行での充足', () => {
    it('複数の条件はすべて満たす仕訳だけを返す(AND)', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', memo: '食費', sourceType: 'manual', lines: [{ accountId: 10, amount: 800 }] }),
        buildEntry({ id: 2, entryDate: '2026-08-01', memo: '食費', sourceType: 'external_import', lines: [{ accountId: 10, amount: 800 }] }),
        buildEntry({ id: 3, entryDate: '2026-08-01', memo: '食費', sourceType: 'manual', lines: [{ accountId: 10, amount: 100 }] }),
        buildEntry({ id: 4, entryDate: '2026-09-01', memo: '食費', sourceType: 'manual', lines: [{ accountId: 10, amount: 800 }] }),
      ]

      const result = filterJournalEntries(entries, [], {
        dateTo: '2026-08-31',
        memo: '食費',
        sourceTypes: ['manual'],
        amountMin: 500,
        accountIds: [10],
      })

      expect(ids(result)).toEqual([1])
    })

    it('複数の条件を別々の明細行で満たす仕訳もヒットする(例: 楽天カードで払った食費)', () => {
      const CARD = 20
      const FOOD = 30
      const entry = buildEntry({
        id: 1,
        entryDate: '2026-08-01',
        lines: [
          { accountId: FOOD, side: 'debit', counterpartyId: 5 },
          { accountId: CARD, side: 'credit' },
        ],
      })
      const other = buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: FOOD }, { accountId: 99, side: 'credit' }] })

      const result = filterJournalEntries([entry, other], [], { accountIds: [CARD], counterpartyIds: [5] })

      expect(ids(result)).toEqual([1])
      // 科目はクレジットカード行、取引先は食費行と、別々の行で満たしている
      expect(entry.lines.some((l) => l.accountId === CARD && l.counterpartyId === 5)).toBe(false)
    })

    it('従来の単一指定(accountId等)と新しい複数指定を同時に指定すると、両方を満たす仕訳だけを返す', () => {
      const entries = [
        buildEntry({ id: 1, entryDate: '2026-08-01', lines: [{ accountId: 10 }, { accountId: 11 }] }),
        buildEntry({ id: 2, entryDate: '2026-08-01', lines: [{ accountId: 10 }] }),
      ]

      expect(ids(filterJournalEntries(entries, [], { accountId: 10, accountIds: [11, 12] }))).toEqual([1])
    })
  })
})
