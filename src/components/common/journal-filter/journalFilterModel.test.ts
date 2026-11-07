/**
 * 仕訳の絞り込みUIと検索条件(JournalEntryFilter)の相互変換の純粋関数のテスト(計画Issue #150)。
 * 選択ツリーの値(項目は「ID」、グループは「g:ID」、未選択は空文字)と、フィルタの
 * accountIds / accountGroupIds 等の対応、金額・精算バッチの変換、有効な条件の数え方を検証する。
 * 外部依存なし(DB・DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import {
  countActiveConditions,
  getBatchValue,
  getTreeValue,
  NO_BATCH_VALUE,
  setAmount,
  setBatchValue,
  setMemo,
  setSingleValue,
  setTreeValue,
} from './journalFilterModel'

describe('getTreeValue / setTreeValue', () => {
  it('項目を選ぶと「〜Ids」に1件だけ入り、グループ指定は外れる', () => {
    const filter: JournalEntryFilter = { accountGroupIds: [3] }
    const next = setTreeValue(filter, 'account', '12')
    expect(next).toEqual({ accountIds: [12] })
    expect(getTreeValue(next, 'account')).toBe('12')
  })

  it('グループを選ぶと「〜GroupIds」に入り、項目の指定は外れる', () => {
    const filter: JournalEntryFilter = { counterpartyIds: [4] }
    const next = setTreeValue(filter, 'counterparty', 'g:7')
    expect(next).toEqual({ counterpartyGroupIds: [7] })
    expect(getTreeValue(next, 'counterparty')).toBe('g:7')
  })

  it('空文字を選ぶとその軸の指定がすべて消え、他の条件は残る', () => {
    const filter: JournalEntryFilter = { projectIds: [1], projectGroupIds: [2], memo: '昼食' }
    expect(setTreeValue(filter, 'project', '')).toEqual({ memo: '昼食' })
    expect(getTreeValue({}, 'project')).toBe('')
  })

  it('元のfilterオブジェクトは書き換えない', () => {
    const filter: JournalEntryFilter = { accountIds: [1] }
    setTreeValue(filter, 'account', '2')
    expect(filter).toEqual({ accountIds: [1] })
  })
})

describe('setMemo', () => {
  it('空白だけの文字列は条件なしとして扱い、キーを消す', () => {
    expect(setMemo({ memo: '昼食' }, '  ')).toEqual({})
    expect(setMemo({}, 'ランチ')).toEqual({ memo: 'ランチ' })
  })
})

describe('setAmount', () => {
  it('数字は数値に変換し、空欄はキーを消す', () => {
    expect(setAmount({}, 'amountMin', '1000')).toEqual({ amountMin: 1000 })
    expect(setAmount({ amountMax: 5000 }, 'amountMax', '')).toEqual({})
  })

  it('数値として読めない入力は無視する(現在の条件を変えない)', () => {
    expect(setAmount({ amountMin: 1 }, 'amountMin', 'abc')).toEqual({ amountMin: 1 })
  })
})

describe('精算バッチ', () => {
  it('「未割当」はnull、バッチはIDで保持し、選択ツリーの値に相互変換できる', () => {
    expect(setBatchValue({}, NO_BATCH_VALUE)).toEqual({ settlementBatchIds: [null] })
    expect(setBatchValue({}, '5')).toEqual({ settlementBatchIds: [5] })
    expect(getBatchValue({ settlementBatchIds: [null] })).toBe(NO_BATCH_VALUE)
    expect(getBatchValue({ settlementBatchIds: [5] })).toBe('5')
    expect(getBatchValue({})).toBe('')
    expect(setBatchValue({ settlementBatchIds: [5] }, '')).toEqual({})
  })
})

describe('setSingleValue', () => {
  it('世帯メンバーは数値ID、作成経路は文字列で1件だけ保持し、空文字で消す', () => {
    expect(setSingleValue({}, 'householdMemberIds', '2')).toEqual({ householdMemberIds: [2] })
    expect(setSingleValue({}, 'sourceTypes', 'manual')).toEqual({ sourceTypes: ['manual'] })
    expect(setSingleValue({ sourceTypes: ['manual'] }, 'sourceTypes', '')).toEqual({})
  })
})

describe('countActiveConditions', () => {
  it('期間は開始・終了のどちらかがあれば1件、金額も同様に数える', () => {
    expect(countActiveConditions({})).toBe(0)
    expect(countActiveConditions({ dateFrom: '2026-01-01', dateTo: '2026-02-01' })).toBe(1)
    expect(countActiveConditions({ amountMin: 1, amountMax: 2 })).toBe(1)
  })

  it('各軸を1件として数え、空配列や空白の摘要は数えない', () => {
    const filter: JournalEntryFilter = {
      memo: '昼食',
      accountIds: [1],
      counterpartyGroupIds: [2],
      projectIds: [],
      householdMemberIds: [1],
      settlementBatchIds: [null],
      sourceTypes: ['manual'],
    }
    expect(countActiveConditions(filter)).toBe(6)
    expect(countActiveConditions({ memo: '  ' })).toBe(0)
  })
})
