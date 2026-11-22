/**
 * importTabs(明細取込画面の一覧のタブ分けとページ送り、計画Issue #263)のユニットテスト。
 * 行を「新規」「重複」のどちらのタブに出すか、「新規」タブで似た取引の行を先頭に並べる順、
 * タブごとのページ区切り(件数・ページ範囲・ページ番号の並び)、タブ見出しに出す件数と状態の集計を検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { createInitialRowState } from './importRowModel'
import {
  IMPORT_PAGE_SIZE,
  buildTabIndices,
  clampPage,
  newTabRank,
  pageNumbers,
  pageRange,
  summarizeTabs,
  tabOfRow,
} from './importTabs'

const record = (overrides: Partial<{ isExactDuplicate: boolean; approximateCandidates: unknown[] }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

const row = (counterAccountId: number | null, overrides: Record<string, unknown> = {}) => ({
  ...createInitialRowState({ counterpartyId: null, counterAccountId, candidateCounterpartyIds: [] }),
  ...overrides,
})

describe('tabOfRow', () => {
  it('取り込み済みと完全一致して、取り込まない行は「重複」タブに出す', () => {
    expect(tabOfRow(record({ isExactDuplicate: true }), row(null))).toBe('duplicate')
  })

  it('完全一致でも「取り込む」を選んだ行は「新規」タブに移る', () => {
    expect(tabOfRow(record({ isExactDuplicate: true }), row(null, { includeDuplicate: true }))).toBe('new')
  })

  it('似た取引がある行と、ふつうの行は「新規」タブに出す', () => {
    expect(tabOfRow(record({ approximateCandidates: [{}] }), row(1))).toBe('new')
    expect(tabOfRow(record(), row(null))).toBe('new')
  })

  it('似た取引を「保存しない」にした行も、「新規」タブに残す(選び直せるように)', () => {
    expect(tabOfRow(record({ approximateCandidates: [{}] }), row(1, { approximateDecision: 'skip' }))).toBe('new')
  })
})

describe('newTabRank', () => {
  it('「新規」タブでは、似た取引の行を先頭(0)、ほかの行を後ろ(1)に並べる', () => {
    expect(newTabRank(record({ approximateCandidates: [{}] }))).toBe(0)
    expect(newTabRank(record())).toBe(1)
  })

  it('「取り込む」を選んだ重複の行は、ふつうの行と同じ後ろ(1)に並べる', () => {
    expect(newTabRank(record({ isExactDuplicate: true }))).toBe(1)
  })
})

describe('clampPage', () => {
  it('ページ番号を1〜ページ数の範囲に収める', () => {
    expect(clampPage(0, 5)).toBe(1)
    expect(clampPage(3, 5)).toBe(3)
    expect(clampPage(9, 5)).toBe(5)
  })

  it('ページ数が0(行が無い)のときは1にする', () => {
    expect(clampPage(4, 0)).toBe(1)
  })
})

describe('pageRange', () => {
  it('1ページ目は先頭から1ページ分の範囲を返し、ページ数は切り上げる', () => {
    expect(pageRange({ total: 120, page: 1, pageSize: 50 })).toEqual({ page: 1, pageCount: 3, start: 0, end: 50, from: 1, to: 50 })
  })

  it('最終ページは残りの件数だけを返す', () => {
    expect(pageRange({ total: 120, page: 3, pageSize: 50 })).toEqual({ page: 3, pageCount: 3, start: 100, end: 120, from: 101, to: 120 })
  })

  it('範囲外のページ番号は最終ページに収める(確定などで行が減ったとき)', () => {
    expect(pageRange({ total: 60, page: 9, pageSize: 50 }).page).toBe(2)
  })

  it('行が0件のときは範囲が空で、ページ数は0', () => {
    expect(pageRange({ total: 0, page: 1, pageSize: 50 })).toEqual({ page: 1, pageCount: 0, start: 0, end: 0, from: 0, to: 0 })
  })

  it('1ページの件数の既定値は正の整数である', () => {
    expect(Number.isInteger(IMPORT_PAGE_SIZE)).toBe(true)
    expect(IMPORT_PAGE_SIZE).toBeGreaterThan(0)
  })
})

describe('pageNumbers', () => {
  it('ページ数が少ないときは、すべての番号を並べる', () => {
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('先頭に近いときは、先頭の数ページと最終ページの間を「…」で省く', () => {
    expect(pageNumbers(1, 8)).toEqual([1, 2, 3, 4, 'gap', 8])
  })

  it('途中のページでは、先頭・最終ページと、いまのページの前後を出して、離れた所は「…」で省く', () => {
    expect(pageNumbers(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
  })

  it('最終ページに近いときは、先頭と、最後の数ページを出す', () => {
    expect(pageNumbers(8, 8)).toEqual([1, 'gap', 5, 6, 7, 8])
  })

  it('ページが1つ(または0)のときは、番号を並べない', () => {
    expect(pageNumbers(1, 1)).toEqual([])
    expect(pageNumbers(1, 0)).toEqual([])
  })
})

describe('buildTabIndices', () => {
  const records = [
    record(), // 0: ふつう
    record({ approximateCandidates: [{}] }), // 1: 似た取引
    record({ isExactDuplicate: true }), // 2: 重複
    record(), // 3: ふつう
    record({ approximateCandidates: [{}] }), // 4: 似た取引
    record({ isExactDuplicate: true }), // 5: 重複(取り込むを選んだ)
  ]
  const rows = [row(null), row(null), row(null), row(null), row(null), row(1, { includeDuplicate: true })]
  const byIndex = (a: number, b: number) => a - b

  it('行を「新規」「重複」のタブに振り分ける', () => {
    const tabs = buildTabIndices([0, 1, 2, 3, 4, 5], records, rows, byIndex)
    expect(tabs.duplicate).toEqual([2])
    expect(tabs.new).toHaveLength(5)
  })

  it('「新規」タブでは、似た取引の行を先頭に寄せ、そのあとはもとの並び(比較の関数)で並べる', () => {
    const tabs = buildTabIndices([0, 1, 2, 3, 4, 5], records, rows, byIndex)
    expect(tabs.new).toEqual([1, 4, 0, 3, 5])
  })

  it('並び替えの比較の関数を渡すと、似た取引の行の中でも、ふつうの行の中でもその順になる', () => {
    const tabs = buildTabIndices([0, 1, 2, 3, 4, 5], records, rows, (a, b) => b - a)
    expect(tabs.new).toEqual([4, 1, 5, 3, 0])
  })

  it('渡した行の番号だけを振り分ける(確定済みの行を除いて渡す)', () => {
    const tabs = buildTabIndices([3, 2], records, rows, byIndex)
    expect(tabs).toEqual({ new: [3], duplicate: [2] })
  })
})

describe('summarizeTabs', () => {
  const records = [
    record(), // 0: ふつう・未入力
    record(), // 1: ふつう・入力済み
    record({ approximateCandidates: [{}] }), // 2: 似た取引・入力済み
    record({ approximateCandidates: [{}] }), // 3: 似た取引・未入力
    record({ isExactDuplicate: true }), // 4: 重複
    record({ isExactDuplicate: true }), // 5: 重複(取り込むを選んだ)
  ]
  const rows = [row(null), row(1), row(1), row(null), row(null), row(1, { includeDuplicate: true })]

  it('タブごとの件数を数える(取り込むを選んだ重複は「新規」に数える)', () => {
    const summary = summarizeTabs([0, 1, 2, 3, 4, 5], records, rows)
    expect(summary.newCount).toBe(5)
    expect(summary.duplicateCount).toBe(1)
  })

  it('「新規」タブの札に出す、似た取引の行数と、未入力(相手科目などが決まっていない)の行数を数える', () => {
    const summary = summarizeTabs([0, 1, 2, 3, 4, 5], records, rows)
    expect(summary.similarCount).toBe(2)
    expect(summary.uncheckedCount).toBe(2)
  })

  it('「保存しない」にした似た取引の行は、似た取引にも未入力にも数えない', () => {
    const skipped = [row(null), row(1), row(null, { approximateDecision: 'skip' }), row(null), row(null), row(1)]
    const summary = summarizeTabs([2], records, skipped)
    expect(summary.similarCount).toBe(0)
    expect(summary.uncheckedCount).toBe(0)
  })

  it('渡した行の番号だけを数える(確定済みの行を除いて渡す)', () => {
    const summary = summarizeTabs([0, 4], records, rows)
    expect(summary.newCount).toBe(1)
    expect(summary.duplicateCount).toBe(1)
  })
})
