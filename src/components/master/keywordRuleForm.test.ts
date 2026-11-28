/**
 * keywordRuleForm(キーワードルールの共通検証と、一覧の並び替え)のテスト。
 * キーワードタブ・勘定科目タブ・取引先タブのどの経路からでも同じ理由で不正なキーワードが拒否されること
 * (空・同じ対象内での重複・取引先も科目も未指定・取引先に資産/負債の科目を併記)と、列見出しによる
 * 昇順・降順の並び替えを検証する(計画Issue #219、docs/decisions/2026-11-16-06.md 2026-11-16 決定9)。
 * 外部依存なし(純粋関数)。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import { nextSortState, planBulkChange, sortKeywordRules, validateKeywordRuleInput } from './keywordRuleForm'

const account = (id: number, category: Account['category']): Pick<Account, 'id' | 'category'> => ({ id, category })
const rule = (id: number, pattern: string, counterpartyId: number | null, accountId: number | null): KeywordRule => ({
  id,
  pattern,
  counterpartyId,
  accountId,
  createdAt: '',
})

describe('validateKeywordRuleInput', () => {
  const base = { pattern: 'ATM', counterpartyId: null, accountId: 10, account: account(10, 'asset'), siblings: [] }

  it('問題がなければnull', () => {
    expect(validateKeywordRuleInput(base)).toBeNull()
  })

  it('空のキーワードは empty', () => {
    expect(validateKeywordRuleInput({ ...base, pattern: '  ' })).toBe('empty')
  })

  it('同じ対象(取引先・科目)の別のルールと正規化後に同じなら duplicate', () => {
    const siblings = [rule(1, 'ａｔｍ', null, 10)]

    expect(validateKeywordRuleInput({ ...base, siblings })).toBe('duplicate')
  })

  it('対象が違うルールとは重複とみなさない', () => {
    const siblings = [rule(1, 'ATM', null, 11)]

    expect(validateKeywordRuleInput({ ...base, siblings })).toBeNull()
  })

  it('取引先も科目も指定しなければ targetRequired', () => {
    expect(validateKeywordRuleInput({ ...base, accountId: null, account: null })).toBe('targetRequired')
  })

  it('取引先と資産・負債の科目の併記は counterpartyNeedsPlAccount', () => {
    expect(validateKeywordRuleInput({ ...base, counterpartyId: 5 })).toBe('counterpartyNeedsPlAccount')
  })

  it('取引先と収益・費用の科目の併記は許可する', () => {
    expect(validateKeywordRuleInput({ ...base, counterpartyId: 5, accountId: 20, account: account(20, 'expense') })).toBeNull()
  })
})

describe('sortKeywordRules / nextSortState', () => {
  const names = { counterparty: (id: number | null) => (id === 5 ? 'イオン' : ''), account: (id: number | null) => (id === 10 ? '現金' : '') }
  const rules = [rule(1, 'VISA', null, null), rule(2, 'AEON', 5, null), rule(3, 'ATM', null, 10)]

  it('キーワード昇順に並べる', () => {
    expect(sortKeywordRules(rules, { key: 'pattern', direction: 'asc' }, names).map((r) => r.pattern)).toEqual(['AEON', 'ATM', 'VISA'])
  })

  it('キーワード降順に並べる', () => {
    expect(sortKeywordRules(rules, { key: 'pattern', direction: 'desc' }, names).map((r) => r.pattern)).toEqual(['VISA', 'ATM', 'AEON'])
  })

  it('取引先の列で並べると、取引先が無いものは昇順で最後に回る', () => {
    expect(sortKeywordRules(rules, { key: 'counterparty', direction: 'asc' }, names).map((r) => r.id)).toEqual([2, 1, 3])
  })

  it('同じ列の見出しを押すと昇順と降順が入れ替わり、別の列を押すとその列の昇順になる', () => {
    expect(nextSortState({ key: 'pattern', direction: 'asc' }, 'pattern')).toEqual({ key: 'pattern', direction: 'desc' })
    expect(nextSortState({ key: 'pattern', direction: 'desc' }, 'pattern')).toEqual({ key: 'pattern', direction: 'asc' })
    expect(nextSortState({ key: 'pattern', direction: 'desc' }, 'account')).toEqual({ key: 'account', direction: 'asc' })
  })
})

describe('planBulkChange(選んだ複数のルールの取引先・科目の一括変更)', () => {
  const accounts = [account(10, 'asset'), account(20, 'expense'), account(21, 'expense')]
  const rules = [rule(1, 'ATM', null, 10), rule(2, 'AEON', 5, 20), rule(3, 'SEVEN', 6, 20)]

  it('「変更しない」の項目は元の値のまま、変更する項目だけを差し替える', () => {
    const plan = planBulkChange({ rules, checkedIds: [2, 3], change: { counterparty: 'keep', account: 21 }, accounts })

    expect(plan).toEqual({
      ok: true,
      updates: [
        { id: 2, counterpartyId: 5, accountId: 21 },
        { id: 3, counterpartyId: 6, accountId: 21 },
      ],
    })
  })

  it('取引先を「指定しない」にすると、取引先を外す', () => {
    const plan = planBulkChange({ rules, checkedIds: [2], change: { counterparty: null, account: 'keep' }, accounts })

    expect(plan).toEqual({ ok: true, updates: [{ id: 2, counterpartyId: null, accountId: 20 }] })
  })

  it('取引先と資産・負債の科目の併記になる変更は、1件でもあれば全体を拒否する', () => {
    const plan = planBulkChange({ rules, checkedIds: [2, 3], change: { counterparty: 'keep', account: 10 }, accounts })

    expect(plan).toEqual({ ok: false, error: 'counterpartyNeedsPlAccount' })
  })

  it('取引先も科目も無くなる変更は拒否する', () => {
    const plan = planBulkChange({ rules, checkedIds: [2], change: { counterparty: null, account: null }, accounts })

    expect(plan).toEqual({ ok: false, error: 'targetRequired' })
  })

  it('変更後に、選んでいないルールや選んだ別のルールと同じキーワード・同じ対象になるなら拒否する', () => {
    const dup = [rule(1, 'ATM', null, 10), rule(2, 'ATM', null, 11), rule(3, 'ATM', null, 11)]

    const plan = planBulkChange({
      rules: dup,
      checkedIds: [1, 2],
      change: { counterparty: 'keep', account: 11 },
      accounts: [account(10, 'asset'), account(11, 'asset')],
    })

    expect(plan).toEqual({ ok: false, error: 'duplicate' })
  })
})

