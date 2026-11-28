/**
 * journalEntrySort(仕訳一覧の明細行単位の表・割勘の候補表の、列見出しでの並び替えの値の取り方、計画Issue #302)のユニットテスト。
 * 並び替えの単位は仕訳(同じ仕訳の借方・貸方の行は分断しない)。日付・出どころ・摘要・コメントは仕訳の値、
 * 借方・貸方の列(科目・プロジェクト・取引先/精算バッチ・世帯メンバー・金額)は、その側の先頭の明細行(表の1行目に出る行)の値を使うこと、
 * 未設定の値(空欄・その側の行が無い)は昇順でも降順でも最後に置くことを検証する。共通の並び替えの仕組みは tableSort のテストが持つ。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { compareJournalSort, cycleJournalSort, journalSortValue, type JournalSortLookup } from './journalEntrySort'

const lookup: JournalSortLookup = {
  accountName: (id) => ({ 1: '食費', 2: '現金', 3: '交通費', 4: '預金' })[id] ?? '',
  projectName: (id) => ({ 1: '旅行' })[id] ?? '',
  counterpartyName: (id) => ({ 1: 'スーパー' })[id] ?? '',
  batchName: (id) => ({ 1: '10月精算' })[id] ?? '',
  memberName: (id) => ({ 1: '太郎', 2: '花子' })[id] ?? '',
}

const line = (id: number, side: 'debit' | 'credit', accountId: number, overrides: Partial<JournalLine> = {}): JournalLine => ({
  id,
  journalEntryId: 0,
  accountId,
  projectId: null,
  householdMemberId: 1,
  counterpartyId: null,
  settlementBatchId: null,
  side,
  amount: 1000,
  createdAt: '',
  ...overrides,
})

const entry = (id: number, overrides: Partial<JournalEntry> = {}): JournalEntry =>
  ({
    id,
    entryDate: '2026-10-05',
    memo: 'ランチ',
    comment: null,
    currency: 'JPY',
    sourceType: 'manual',
    householdMemberId: 1,
    lines: [line(id * 10, 'debit', 1), line(id * 10 + 1, 'credit', 2)],
    ...overrides,
  }) as JournalEntry

/** 並び替えの結果の仕訳idの並び(同じ値は元の順=配列の順を保つ) */
function order(sort: ReturnType<typeof cycleJournalSort>, entries: readonly JournalEntry[]): number[] {
  return entries
    .map((e, index) => ({ id: e.id, index }))
    .sort((a, b) => compareJournalSort(sort, a.id, b.id) || a.index - b.index)
    .map((e) => e.id)
}

describe('journalSortValue', () => {
  it('日付・摘要・コメントは仕訳の値、空の摘要・コメントは未設定(null)になる', () => {
    const e = entry(1, { entryDate: '2026-10-07', memo: 'ランチ', comment: '会社の近く' })
    expect(journalSortValue('date', e, lookup)).toBe('2026-10-07')
    expect(journalSortValue('memo', e, lookup)).toBe('ランチ')
    expect(journalSortValue('comment', e, lookup)).toBe('会社の近く')
    expect(journalSortValue('memo', entry(2, { memo: null }), lookup)).toBeNull()
    expect(journalSortValue('comment', entry(3, { comment: '' }), lookup)).toBeNull()
  })

  it('出どころは、表に出るタグの文言(取込済みで金融機関が分かれば金融機関名)で並べる', () => {
    expect(journalSortValue('source', entry(1, { sourceType: 'external_import', financialInstitutionName: 'みずほ銀行' }), lookup)).toBe('みずほ銀行')
  })

  it('借方・貸方の列は、その側の先頭の明細行の値を使う(複合仕訳でも先頭行)', () => {
    const e = entry(1, {
      lines: [
        line(1, 'debit', 1, { amount: 700, householdMemberId: 2 }),
        line(2, 'debit', 3, { amount: 300 }),
        line(3, 'credit', 2, { amount: 1000 }),
      ],
    })
    expect(journalSortValue('debit-account', e, lookup)).toBe('食費')
    expect(journalSortValue('debit-amount', e, lookup)).toBe(700)
    expect(journalSortValue('debit-member', e, lookup)).toBe('花子')
    expect(journalSortValue('credit-account', e, lookup)).toBe('現金')
    expect(journalSortValue('credit-amount', e, lookup)).toBe(1000)
  })

  it('取引先・精算バッチの列は、付いている方の名前を使い、どちらも無ければ未設定', () => {
    const withCounterparty = entry(1, { lines: [line(1, 'debit', 1, { counterpartyId: 1 }), line(2, 'credit', 2)] })
    const withBatch = entry(2, { lines: [line(3, 'debit', 1), line(4, 'credit', 2, { settlementBatchId: 1 })] })
    expect(journalSortValue('debit-partner', withCounterparty, lookup)).toBe('スーパー')
    expect(journalSortValue('credit-partner', withBatch, lookup)).toBe('10月精算')
    expect(journalSortValue('credit-partner', withCounterparty, lookup)).toBeNull()
  })

  it('プロジェクトが無い行・その側の行が無い仕訳は未設定(null)', () => {
    const debitOnly = entry(1, { lines: [line(1, 'debit', 1)] })
    expect(journalSortValue('debit-project', debitOnly, lookup)).toBeNull()
    expect(journalSortValue('credit-account', debitOnly, lookup)).toBeNull()
    expect(journalSortValue('credit-amount', debitOnly, lookup)).toBeNull()
  })
})

describe('cycleJournalSort と compareJournalSort', () => {
  it('同じ列を押すたびに 昇順 → 降順 → 解除 と切り替わる', () => {
    const entries = [entry(1)]
    const asc = cycleJournalSort(null, 'date', entries, lookup)
    expect(asc).toMatchObject({ key: 'date', direction: 'asc' })
    const desc = cycleJournalSort(asc, 'date', entries, lookup)
    expect(desc).toMatchObject({ key: 'date', direction: 'desc' })
    expect(cycleJournalSort(desc, 'date', entries, lookup)).toBeNull()
  })

  it('日付の昇順・降順で、仕訳ごとに並ぶ', () => {
    const entries = [entry(1, { entryDate: '2026-10-07' }), entry(2, { entryDate: '2026-10-05' }), entry(3, { entryDate: '2026-10-06' })]
    const asc = cycleJournalSort(null, 'date', entries, lookup)
    expect(order(asc, entries)).toEqual([2, 3, 1])
    expect(order(cycleJournalSort(asc, 'date', entries, lookup), entries)).toEqual([1, 3, 2])
  })

  it('借方の科目で並べ、その側の行が無い仕訳は昇順でも降順でも最後に置く', () => {
    const entries = [
      entry(1, { lines: [line(1, 'credit', 2)] }),
      entry(2, { lines: [line(2, 'debit', 3), line(3, 'credit', 2)] }),
      entry(3, { lines: [line(4, 'debit', 1), line(5, 'credit', 2)] }),
    ]
    // 文字コード順なので「交通費」(仕訳2)が「食費」(仕訳3)より前
    const asc = cycleJournalSort(null, 'debit-account', entries, lookup)
    expect(order(asc, entries)).toEqual([2, 3, 1])
    expect(order(cycleJournalSort(asc, 'debit-account', entries, lookup), entries)).toEqual([3, 2, 1])
  })

  it('押した時点の値で決まり、そのあと科目を編集しても並びは動かない', () => {
    const entries = [entry(1, { lines: [line(1, 'debit', 3), line(2, 'credit', 2)] }), entry(2, { lines: [line(3, 'debit', 1), line(4, 'credit', 2)] })]
    const asc = cycleJournalSort(null, 'debit-account', entries, lookup)
    // 文字コード順なので「交通費」(仕訳1)が「食費」(仕訳2)より前
    expect(order(asc, entries)).toEqual([1, 2])
    // 仕訳1の借方の科目を「預金」に直しても(並べ直せば仕訳2が先になる)、押した時点の並びのまま
    const edited = [entry(1, { lines: [line(1, 'debit', 4), line(2, 'credit', 2)] }), entries[1]]
    expect(order(asc, edited)).toEqual([1, 2])
  })

  it('金額は数として比べる', () => {
    const entries = [
      entry(1, { lines: [line(1, 'debit', 1, { amount: 900 }), line(2, 'credit', 2, { amount: 900 })] }),
      entry(2, { lines: [line(3, 'debit', 1, { amount: 12000 }), line(4, 'credit', 2, { amount: 12000 })] }),
    ]
    expect(order(cycleJournalSort(null, 'debit-amount', entries, lookup), entries)).toEqual([1, 2])
  })
})
