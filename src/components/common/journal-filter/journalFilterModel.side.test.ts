/**
 * journalFilterModel の「借方・貸方を分けた条件」まわりの純粋関数のユニットテスト(計画Issue #314)。
 * 科目・取引先・プロジェクト・世帯メンバー・精算バッチの値を、まとめて(both)・借方(debit)・貸方(credit)の範囲ごとに
 * 取り出し・書き込みできること、まとめてと借方・貸方を切り替えるときは切替先と競合する条件を消すこと、
 * 条件の数に借方・貸方の条件が含まれることを検証する。DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  countActiveConditions,
  getBatchValues,
  getMemberValues,
  getTreeValues,
  hasSideConditions,
  setBatchValues,
  setMemberValues,
  setTreeValues,
  toCombinedMode,
  toSplitMode,
} from './journalFilterModel'

describe('getTreeValues / setTreeValues(範囲ごと)', () => {
  it('借方の科目を書くと debit.accountIds に入り、貸方・まとめては変わらない', () => {
    const next = setTreeValues({}, 'account', ['9'], 'debit')

    expect(next).toEqual({ debit: { accountIds: [9] } })
    expect(getTreeValues(next, 'account', 'debit')).toEqual(['9'])
    expect(getTreeValues(next, 'account', 'credit')).toEqual([])
    expect(getTreeValues(next, 'account')).toEqual([])
  })

  it('グループ(g:ID)は、その範囲の「〜GroupIds」に振り分ける', () => {
    const next = setTreeValues({}, 'counterparty', ['2', 'g:5'], 'credit')

    expect(next).toEqual({ credit: { counterpartyIds: [2], counterpartyGroupIds: [5] } })
    expect(getTreeValues(next, 'counterparty', 'credit')).toEqual(['2', 'g:5'])
  })

  it('空配列で、その範囲のその軸を消し、範囲に何も残らなければ debit / credit のキーごと消す', () => {
    const filter = { debit: { accountIds: [9] }, credit: { projectIds: [3] } }

    expect(setTreeValues(filter, 'account', [], 'debit')).toEqual({ credit: { projectIds: [3] } })
  })

  it('範囲を省略した従来の呼び出しは、まとめての軸を読み書きする(従来どおり)', () => {
    expect(setTreeValues({}, 'project', ['3'])).toEqual({ projectIds: [3] })
  })
})

describe('getMemberValues / setMemberValues / getBatchValues / setBatchValues(範囲ごと)', () => {
  it('世帯メンバーを借方に書くと debit.householdMemberIds に入る', () => {
    const next = setMemberValues({}, ['4', '5'], 'debit')

    expect(next).toEqual({ debit: { householdMemberIds: [4, 5] } })
    expect(getMemberValues(next, 'debit')).toEqual(['4', '5'])
  })

  it('精算バッチの「未割当」(none)は、その範囲では null で保持する', () => {
    const next = setBatchValues({}, ['none', '8'], 'credit')

    expect(next).toEqual({ credit: { settlementBatchIds: [null, 8] } })
    expect(getBatchValues(next, 'credit')).toEqual(['none', '8'])
  })
})

describe('toSplitMode / toCombinedMode / hasSideConditions(まとめて⇔借方・貸方の切替)', () => {
  const combined = {
    memo: '昼食',
    accountIds: [1],
    counterpartyGroupIds: [2],
    projectIds: [3],
    householdMemberIds: [4],
    settlementBatchIds: [null],
    sourceTypes: ['manual' as const],
  }

  it('借方・貸方に分けるときは、競合するまとめての5軸を消し、摘要・出どころなど仕訳単位の条件は残す', () => {
    expect(toSplitMode(combined)).toEqual({ memo: '昼食', sourceTypes: ['manual'] })
  })

  it('まとめてに戻すときは、借方・貸方の条件を消す', () => {
    const split = { memo: '昼食', debit: { accountIds: [1] }, credit: { accountIds: [2] } }

    expect(toCombinedMode(split)).toEqual({ memo: '昼食' })
  })

  it('借方・貸方の条件があるかどうか', () => {
    expect(hasSideConditions({})).toBe(false)
    expect(hasSideConditions({ debit: {} })).toBe(false)
    expect(hasSideConditions({ credit: { accountIds: [1] } })).toBe(true)
  })
})

describe('countActiveConditions(借方・貸方)', () => {
  it('借方・貸方の条件は、側ごと・軸ごとに1件として数える', () => {
    const filter = {
      debit: { accountIds: [1], accountGroupIds: [10], counterpartyIds: [2] },
      credit: { accountIds: [3] },
    }

    // 借方の科目(項目+グループで1件)、借方の取引先、貸方の科目
    expect(countActiveConditions(filter)).toBe(3)
  })
})
