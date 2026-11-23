/**
 * planLineExpenseSplit(選んだ明細行と、負担する人ごとの入力から、行ごとの負担額を決める純粋関数、計画Issue #271)の
 * ユニットテスト。submitExpenseSplit(書き込み)と割勘仕訳のプレビューが同じ計算を使うために切り出したもの。
 * 負担する人には立て替えた本人も入れ、割合は合計100%、金額は合計が選んだ行の純額に合うことを求めること、
 * 均等・割合は行ごとに按分して借方を正・貸方を負にすること、金額指定は純額に対する割合で配分すること、
 * 自分が立て替えた行は仕訳にしないこと(自分との割勘にしない)、費用・収益でない行・純額0のエラーを返すことを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine } from '../../domain/journal/JournalEntry'
import { planLineExpenseSplit } from './planLineExpenseSplit'

const FOOD = 1
const INCOME = 2
const CASH = 3

function account(id: number, category: Account['category']): Account {
  return {
    id,
    category,
    name: `科目${id}`,
    isReconcilable: null,
    hasExternalStatement: null,
    isActive: true,
    isSystemManaged: false,
    autoBalanceAdjustment: true,
    householdMemberId: null,
    accountGroupId: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  }
}

const ACCOUNTS = [account(FOOD, 'expense'), account(INCOME, 'revenue'), account(CASH, 'asset')]

function line(id: number, accountId: number, side: 'debit' | 'credit', amount: number): JournalLine {
  return {
    id,
    journalEntryId: 1,
    accountId,
    projectId: null,
    householdMemberId: 1,
    counterpartyId: null,
    settlementBatchId: null,
    side,
    amount,
    createdAt: '',
  }
}

/** 立替者(起票者)は世帯メンバー1 */
const ENTRY = {
  id: 1,
  entryDate: '2026-11-01',
  memo: null,
  comment: null,
  currency: 'JPY',
  sourceType: 'manual',
  householdMemberId: 1,
  generatedFromRuleId: null,
  recurringDueDate: null,
  createdAt: '',
  updatedAt: '',
  lines: [],
} satisfies JournalEntry

const food = { entry: ENTRY, line: line(10, FOOD, 'debit', 2000) }
const income = { entry: ENTRY, line: line(11, INCOME, 'credit', 400) }
const cash = { entry: ENTRY, line: line(12, CASH, 'credit', 1600) }

/** 世帯メンバー2(妻)の行 */
const partner = (ratio: string, amount = '') => ({
  key: 1,
  kind: 'householdMember' as const,
  targetId: 2,
  ratioInput: ratio,
  amountInput: amount,
})
/** 世帯メンバー1(立替者本人)の行 */
const self = (ratio: string, amount = '') => ({
  key: 2,
  kind: 'householdMember' as const,
  targetId: 1,
  ratioInput: ratio,
  amountInput: amount,
})

describe('planLineExpenseSplit: 割合・均等', () => {
  it('割合は行ごとに按分し、借方の行は正・貸方の行は負の負担額にする。立替者本人の行は仕訳にしない(自分の負担分は元のまま)', () => {
    const plan = planLineExpenseSplit({
      selectedLines: [food, income],
      accounts: ACCOUNTS,
      participants: [partner('50'), self('50')],
      allocationMode: 'ratio',
    })
    expect(plan).toMatchObject({ ok: true, recipients: [{ row: partner('50'), signedShares: [1000, -200] }] })
    if (plan.ok) expect(plan.recipients).toHaveLength(1)
  })

  it('各人の負担額(自分の分も含む)を返し、合計は選んだ行の純額に一致する', () => {
    const plan = planLineExpenseSplit({
      selectedLines: [food, income],
      accounts: ACCOUNTS,
      participants: [partner('30'), self('70')],
      allocationMode: 'ratio',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.burdens.get(1)).toBe(480) // 食費 600 − 収益 120
    expect(plan.burdens.get(2)).toBe(1120)
    expect([...plan.burdens.values()].reduce((a, b) => a + b, 0)).toBe(1600)
  })

  it('割合の合計が100%でないときはratioTotalMismatchを返す(100%未満・超過とも)', () => {
    for (const rows of [[partner('50'), self('40')], [partner('60'), self('60')], [partner('50')]]) {
      expect(planLineExpenseSplit({ selectedLines: [food], accounts: ACCOUNTS, participants: rows, allocationMode: 'ratio' })).toEqual({
        ok: false,
        error: 'ratioTotalMismatch',
      })
    }
  })

  it('立替者を入れずに相手だけで100%にしてもよい(立替者の負担は0)', () => {
    const plan = planLineExpenseSplit({
      selectedLines: [food],
      accounts: ACCOUNTS,
      participants: [partner('100')],
      allocationMode: 'ratio',
    })
    expect(plan).toMatchObject({ ok: true, recipients: [{ signedShares: [2000] }] })
  })

  it('均等は、入力した人だけで等分する(立替者を入れなければ立替者の負担は0)', () => {
    const plan = planLineExpenseSplit({
      selectedLines: [food],
      accounts: ACCOUNTS,
      participants: [partner(''), self('')],
      allocationMode: 'equal',
    })
    expect(plan).toMatchObject({ ok: true, recipients: [{ signedShares: [1000] }] })
  })

  it('端数が出ても、各人の行ごとの負担額の合計は行の金額と一致する', () => {
    const odd = { entry: ENTRY, line: line(13, FOOD, 'debit', 1001) }
    const third = (key: number, target: number) => ({
      key,
      kind: 'householdMember' as const,
      targetId: target,
      ratioInput: '',
      amountInput: '',
    })
    const plan = planLineExpenseSplit({
      selectedLines: [odd],
      accounts: ACCOUNTS,
      participants: [third(1, 2), third(2, 1), third(3, 3)],
      allocationMode: 'equal',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect([...plan.burdens.values()].reduce((a, b) => a + b, 0)).toBe(1001)
  })

  it('相手が一部の行の立替者でもよい。その相手には、自分が立て替えた行の分は割り当てない(自分との割勘にしない)', () => {
    const other = { entry: { ...ENTRY, id: 2, householdMemberId: 2 }, line: line(14, FOOD, 'debit', 1000) }
    // 食費2000は立替者1、食費1000は立替者2。相手2の負担のうち、立替者2の行の分は仕訳にしない
    const plan = planLineExpenseSplit({
      selectedLines: [food, other],
      accounts: ACCOUNTS,
      participants: [partner('50'), self('50')],
      allocationMode: 'ratio',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const wife = plan.recipients.find((r) => r.row.targetId === 2)
    const husband = plan.recipients.find((r) => r.row.targetId === 1)
    expect(wife?.signedShares).toEqual([1000, 0])
    expect(husband?.signedShares).toEqual([0, 500])
  })

  it('負担額がすべて自分の分(立替者本人が100%)なら、割る行がなくnoRecipientを返す', () => {
    expect(
      planLineExpenseSplit({ selectedLines: [food], accounts: ACCOUNTS, participants: [self('100')], allocationMode: 'ratio' }),
    ).toEqual({ ok: false, error: 'noRecipient' })
  })

  it('費用・収益でない行が混ざるとexpenseAccountNotFoundを返す', () => {
    expect(
      planLineExpenseSplit({ selectedLines: [food, cash], accounts: ACCOUNTS, participants: [partner('100')], allocationMode: 'ratio' }),
    ).toEqual({ ok: false, error: 'expenseAccountNotFound' })
  })
})

describe('planLineExpenseSplit: 金額指定', () => {
  it('入力した金額を純額に対する割合で行へ配分する。合計が純額に一致すればよい', () => {
    // 純額 2000-400 = 1600。相手が800・本人が800
    const plan = planLineExpenseSplit({
      selectedLines: [food, income],
      accounts: ACCOUNTS,
      participants: [partner('', '800'), self('', '800')],
      allocationMode: 'amount',
    })
    expect(plan).toMatchObject({ ok: true, recipients: [{ signedShares: [1000, -200] }] })
    if (plan.ok) expect(plan.burdens.get(1)).toBe(800)
  })

  it('金額の合計が純額と合わないとき(少ない・多い)はamountTotalMismatchを返す', () => {
    for (const rows of [[partner('', '800'), self('', '700')], [partner('', '900'), self('', '800')], [partner('', '800')]]) {
      expect(
        planLineExpenseSplit({ selectedLines: [food, income], accounts: ACCOUNTS, participants: rows, allocationMode: 'amount' }),
      ).toEqual({ ok: false, error: 'amountTotalMismatch' })
    }
  })

  it('純額が0円の行の組み合わせでは、金額指定はamountNetZeroを返す', () => {
    const zero = { entry: ENTRY, line: line(13, FOOD, 'debit', 400) }
    expect(
      planLineExpenseSplit({
        selectedLines: [zero, income],
        accounts: ACCOUNTS,
        participants: [partner('', '100'), self('', '-100')],
        allocationMode: 'amount',
      }),
    ).toEqual({ ok: false, error: 'amountNetZero' })
  })

  it('金額も、まず全体の純額に対する割合で行へ配分し、そのうち相手が立て替えた行の分は仕訳にしない(自分との割勘にしない)', () => {
    const other = { entry: { ...ENTRY, id: 2, householdMemberId: 2 }, line: line(14, FOOD, 'debit', 1000) }
    // 純額 2000+1000 = 3000。相手2が1200なら食費2000へ800・食費1000へ400。食費1000は相手2が立て替えた行なので仕訳にしない
    const plan = planLineExpenseSplit({
      selectedLines: [food, other],
      accounts: ACCOUNTS,
      participants: [partner('', '1200'), self('', '1800')],
      allocationMode: 'amount',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.recipients.find((r) => r.row.targetId === 2)?.signedShares).toEqual([800, 0])
    expect(plan.burdens.get(1)).toBe(1200)
  })
})
