/**
 * recurringRuleForm(計画Issue #154)のテスト。
 * マスタ画面の定期取引ルールのフォーム入力を、Repository送信用の入力に変換する純粋関数を検証する。
 * 繰り返し(毎週・毎月の日付・毎月の第N曜日・毎年)ごとに使うカラムの組み合わせ
 * (docs/domain/recurring-transactions.md 1.3、使わないカラムは必ずnull)、入力が揃ったかの判定、
 * 既存ルールからフォームへの復元を確認する。DOM・sql.js非依存。
 */
import { describe, expect, it } from 'vitest'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import {
  buildRuleInput,
  emptyRuleForm,
  isRuleFormValid,
  ruleFormFromRule,
  type RuleForm,
} from './recurringRuleForm'

function form(overrides: Partial<RuleForm> = {}): RuleForm {
  return {
    ...emptyRuleForm(),
    name: '家賃',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: '98000',
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfMonth: 27,
    ...overrides,
  }
}

describe('buildRuleInput', () => {
  it('毎月の日付指定では、日だけを使い、曜日・週・月はnullにする', () => {
    expect(buildRuleInput(form({ dayOfWeek: 3, weekOfMonth: 2, monthOfYear: 5 }))).toMatchObject({
      frequency: 'monthly',
      dayOfMonth: 27,
      dayOfWeek: null,
      weekOfMonth: null,
      monthOfYear: null,
    })
  })

  it('毎月の第N曜日指定では、週と曜日を使い、日はnullにする', () => {
    expect(
      buildRuleInput(form({ monthlyMode: 'weekday', weekOfMonth: 2, dayOfWeek: 6, dayOfMonth: 27 })),
    ).toMatchObject({ dayOfMonth: null, weekOfMonth: 2, dayOfWeek: 6, monthOfYear: null })
  })

  it('毎週では、曜日だけを使う', () => {
    expect(buildRuleInput(form({ frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 27 }))).toMatchObject({
      dayOfWeek: 1,
      dayOfMonth: null,
      weekOfMonth: null,
      monthOfYear: null,
    })
  })

  it('毎年では、月と日を使う', () => {
    expect(buildRuleInput(form({ frequency: 'yearly', monthOfYear: 4, dayOfMonth: 10 }))).toMatchObject({
      monthOfYear: 4,
      dayOfMonth: 10,
      dayOfWeek: null,
      weekOfMonth: null,
    })
  })

  it('名称・金額・科目・任意項目を、型を整えて渡す(空の任意項目はnull)', () => {
    expect(buildRuleInput(form({ name: ' 家賃 ', projectId: 7, maxOccurrences: '12' }))).toMatchObject({
      name: '家賃',
      debitAccountId: 1,
      creditAccountId: 2,
      amount: 98000,
      projectId: 7,
      householdMemberId: null,
      counterpartyId: null,
      maxOccurrences: 12,
    })
    expect(buildRuleInput(form()).maxOccurrences).toBeNull()
  })
})

describe('isRuleFormValid', () => {
  it('必須項目が揃っていれば有効である', () => {
    expect(isRuleFormValid(form())).toBe(true)
  })

  it('名称・借方・貸方・金額のどれかが欠けると無効である', () => {
    expect(isRuleFormValid(form({ name: ' ' }))).toBe(false)
    expect(isRuleFormValid(form({ debitAccountId: '' }))).toBe(false)
    expect(isRuleFormValid(form({ creditAccountId: '' }))).toBe(false)
    expect(isRuleFormValid(form({ amount: '' }))).toBe(false)
    expect(isRuleFormValid(form({ amount: '0' }))).toBe(false)
    expect(isRuleFormValid(form({ amount: 'abc' }))).toBe(false)
  })

  it('繰り返しごとに必要な項目が欠けると無効である', () => {
    expect(isRuleFormValid(form({ dayOfMonth: '' }))).toBe(false)
    expect(isRuleFormValid(form({ frequency: 'weekly', dayOfWeek: '' }))).toBe(false)
    expect(isRuleFormValid(form({ monthlyMode: 'weekday', weekOfMonth: '', dayOfWeek: 1 }))).toBe(false)
    expect(isRuleFormValid(form({ frequency: 'yearly', monthOfYear: '', dayOfMonth: 10 }))).toBe(false)
  })

  it('回数の上限は、空か正の整数のときだけ有効である', () => {
    expect(isRuleFormValid(form({ maxOccurrences: '12' }))).toBe(true)
    expect(isRuleFormValid(form({ maxOccurrences: '0' }))).toBe(false)
    expect(isRuleFormValid(form({ maxOccurrences: '1.5' }))).toBe(false)
  })
})

describe('ruleFormFromRule', () => {
  const rule: RecurringTransactionRule = {
    id: 1,
    name: '燃えるごみ袋',
    debitAccountId: 1,
    creditAccountId: 2,
    amount: 600,
    frequency: 'monthly',
    dayOfWeek: 6,
    dayOfMonth: null,
    weekOfMonth: 2,
    monthOfYear: null,
    projectId: null,
    householdMemberId: 5,
    counterpartyId: null,
    maxOccurrences: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  it('毎月の第N曜日のルールは、指定方法が曜日のフォームに復元される', () => {
    expect(ruleFormFromRule(rule)).toMatchObject({
      name: '燃えるごみ袋',
      amount: '600',
      monthlyMode: 'weekday',
      weekOfMonth: 2,
      dayOfWeek: 6,
      householdMemberId: 5,
      maxOccurrences: '',
    })
  })

  it('復元したフォームをbuildRuleInputに通すと、元のカラムの組み合わせに戻る', () => {
    expect(buildRuleInput(ruleFormFromRule(rule))).toMatchObject({
      dayOfMonth: null,
      weekOfMonth: 2,
      dayOfWeek: 6,
      householdMemberId: 5,
    })
  })
})
