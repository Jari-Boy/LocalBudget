/**
 * 仕訳の絞り込みUIと検索条件(JournalEntryFilter)の相互変換の純粋関数のテスト(計画Issue #150)。
 * 選択ツリーの値(項目は「ID」、グループは「g:ID」、未選択は空文字)と、フィルタの
 * accountIds / accountGroupIds 等の対応、金額・精算バッチの変換、有効な条件の数え方を検証する。
 * 計画Issue #203で、各軸の複数選択(項目とグループの併用、精算バッチの未割当との併用を含む)の
 * 相互変換を追加した。外部依存なし(DB・DOMに依存しない)。
 */
import { describe, expect, it } from 'vitest'
import type { JournalEntryFilter } from '../../../domain/journal/JournalEntryFilter'
import {
  countActiveConditions,
  getBatchValue,
  getBatchValues,
  getMultiValues,
  getTreeValue,
  getTreeValues,
  NO_BATCH_VALUE,
  setAmount,
  setBatchValue,
  setBatchValues,
  setMemo,
  setMultiValues,
  setSingleValue,
  setTreeValue,
  setTreeValues,
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

describe('getTreeValues / setTreeValues(複数選択、計画Issue #203)', () => {
  it('項目とグループの値を混ぜて渡すと、「〜Ids」と「〜GroupIds」に振り分けて保持する', () => {
    const next = setTreeValues({}, 'account', ['12', 'g:3', '14'])
    expect(next).toEqual({ accountIds: [12, 14], accountGroupIds: [3] })
  })

  it('保持している項目とグループを、項目、グループの順の値の配列として取り出せる', () => {
    expect(getTreeValues({ projectIds: [1, 2], projectGroupIds: [5] }, 'project')).toEqual(['1', '2', 'g:5'])
    expect(getTreeValues({}, 'project')).toEqual([])
  })

  it('空配列を渡すとその軸の指定がすべて消え、他の条件は残る', () => {
    const filter: JournalEntryFilter = { counterpartyIds: [1], counterpartyGroupIds: [2], memo: '昼食' }
    expect(setTreeValues(filter, 'counterparty', [])).toEqual({ memo: '昼食' })
  })

  it('項目だけを渡したときは、グループの指定は空にせずキーごと消す', () => {
    expect(setTreeValues({ accountGroupIds: [3] }, 'account', ['1'])).toEqual({ accountIds: [1] })
  })

  it('元のfilterオブジェクトは書き換えない', () => {
    const filter: JournalEntryFilter = { accountIds: [1] }
    setTreeValues(filter, 'account', ['2', '3'])
    expect(filter).toEqual({ accountIds: [1] })
  })
})

describe('getBatchValues / setBatchValues(複数選択、計画Issue #203)', () => {
  it('「未割当」と複数のバッチを併用でき、選択ツリーの値の配列に相互変換できる', () => {
    const next = setBatchValues({}, [NO_BATCH_VALUE, '5', '7'])
    expect(next).toEqual({ settlementBatchIds: [null, 5, 7] })
    expect(getBatchValues(next)).toEqual([NO_BATCH_VALUE, '5', '7'])
  })

  it('空配列で指定が消え、未指定は空配列になる', () => {
    expect(setBatchValues({ settlementBatchIds: [5], memo: 'a' }, [])).toEqual({ memo: 'a' })
    expect(getBatchValues({})).toEqual([])
  })
})

describe('getMultiValues / setMultiValues(世帯メンバー・出どころの複数選択、計画Issue #203)', () => {
  it('世帯メンバーは数値ID、出どころは文字列で複数保持し、取り出せる', () => {
    const members = setMultiValues({}, 'householdMemberIds', ['1', '2'])
    expect(members).toEqual({ householdMemberIds: [1, 2] })
    expect(getMultiValues(members, 'householdMemberIds')).toEqual(['1', '2'])
    const sources = setMultiValues({}, 'sourceTypes', ['manual', 'external_import'])
    expect(sources).toEqual({ sourceTypes: ['manual', 'external_import'] })
    expect(getMultiValues(sources, 'sourceTypes')).toEqual(['manual', 'external_import'])
  })

  it('空配列で指定が消え、未指定は空配列になる', () => {
    expect(setMultiValues({ sourceTypes: ['manual'] }, 'sourceTypes', [])).toEqual({})
    expect(getMultiValues({}, 'householdMemberIds')).toEqual([])
  })
})

describe('countActiveConditions(複数選択でも軸ごとに1件、計画Issue #203)', () => {
  it('同じ軸に複数の項目・グループを指定しても1件として数える', () => {
    expect(countActiveConditions({ accountIds: [1, 2, 3], accountGroupIds: [4, 5] })).toBe(1)
    expect(countActiveConditions({ settlementBatchIds: [null, 1, 2] })).toBe(1)
    expect(countActiveConditions({ householdMemberIds: [1, 2], sourceTypes: ['manual', 'external_import'] })).toBe(2)
  })
})
