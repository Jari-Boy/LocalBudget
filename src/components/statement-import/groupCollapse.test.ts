/**
 * groupCollapse(明細取込画面の一覧のグループ折りたたみ、計画Issue #231 フェーズ1)のユニットテスト。
 * 3グループ(重複・似た取引あり・問題なし)ごとの開閉の切り替え、重複元の行へ移るときの自動展開、
 * 見出しに出す「未確認の行数」(相手科目が決まっていない行=ステータスが「要確認」の行の数)の数え方を検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { createInitialRowState } from './importRowModel'
import { countUncheckedByGroup, expandGroup, toggleCollapsedGroup } from './groupCollapse'

const record = (overrides: Partial<{ isExactDuplicate: boolean; approximateCandidates: unknown[] }> = {}) =>
  ({ isExactDuplicate: false, approximateCandidates: [], ...overrides }) as never

const row = (counterAccountId: number | null, overrides: Record<string, unknown> = {}) =>
  ({
    ...createInitialRowState({ counterpartyId: null, counterAccountId, candidateCounterpartyIds: [] }),
    ...overrides,
  })

describe('toggleCollapsedGroup', () => {
  it('開いているグループを折りたたみ、折りたたんだグループを開く', () => {
    const collapsed = toggleCollapsedGroup(new Set(), 'clean')
    expect([...collapsed]).toEqual(['clean'])
    expect([...toggleCollapsedGroup(collapsed, 'clean')]).toEqual([])
  })

  it('ほかのグループの開閉は変えない', () => {
    const collapsed = toggleCollapsedGroup(new Set(['duplicate'] as const), 'similar')
    expect([...collapsed].sort()).toEqual(['duplicate', 'similar'])
  })

  it('元の集合を書き換えない', () => {
    const before = new Set(['duplicate'] as const)
    toggleCollapsedGroup(before, 'clean')
    expect([...before]).toEqual(['duplicate'])
  })
})

describe('expandGroup', () => {
  it('折りたたんだグループを開き、ほかのグループは変えない', () => {
    const expanded = expandGroup(new Set(['duplicate', 'clean'] as const), 'clean')
    expect([...expanded]).toEqual(['duplicate'])
  })

  it('すでに開いているグループには何も起きず、同じ集合を返す', () => {
    const before = new Set(['duplicate'] as const)
    expect(expandGroup(before, 'clean')).toBe(before)
  })
})

describe('countUncheckedByGroup', () => {
  it('相手科目が決まっていない行(要確認)だけを、グループごとに数える', () => {
    const records = [
      record(), // 0: 問題なし・相手科目あり
      record(), // 1: 問題なし・相手科目なし
      record({ approximateCandidates: [{}] }), // 2: 似た取引あり・相手科目なし
      record({ approximateCandidates: [{}] }), // 3: 似た取引あり・相手科目あり
    ]
    const rows = [row(1), row(null), row(null), row(1)]

    expect(countUncheckedByGroup([0, 1, 2, 3], records, rows)).toEqual({ duplicate: 0, similar: 1, clean: 1 })
  })

  it('取り込み対象外の重複の行は数えない', () => {
    const records = [record({ isExactDuplicate: true }), record()]
    const rows = [row(null), row(1)]

    expect(countUncheckedByGroup([0, 1], records, rows)).toEqual({ duplicate: 0, similar: 0, clean: 0 })
  })

  it('「取り込む」にした重複の行は、相手科目が無ければ数える', () => {
    const records = [record({ isExactDuplicate: true })]
    const rows = [row(null, { includeDuplicate: true })]

    expect(countUncheckedByGroup([0], records, rows)).toEqual({ duplicate: 1, similar: 0, clean: 0 })
  })

  it('「この取引を保存しない」を選んだ行は数えない', () => {
    const records = [record({ approximateCandidates: [{}] })]
    const rows = [row(null, { approximateDecision: 'skip' })]

    expect(countUncheckedByGroup([0], records, rows)).toEqual({ duplicate: 0, similar: 0, clean: 0 })
  })

  it('渡した行の番号だけを数える(確定済みの行は呼び出し側が除く)', () => {
    const records = [record(), record()]
    const rows = [row(null), row(null)]

    expect(countUncheckedByGroup([1], records, rows)).toEqual({ duplicate: 0, similar: 0, clean: 1 })
  })
})
